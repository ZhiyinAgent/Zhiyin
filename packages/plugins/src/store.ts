import {
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  InvalidPluginError,
  type PluginPackage,
  type PluginProvenance,
} from "./plugins.js";
import { PluginStoreError } from "./errors.js";
import { loadPluginDirectory } from "./package-loader.js";

export type InstalledPlugin = {
  readonly package: PluginPackage;
  readonly activeVersion: string;
  readonly rollbackVersion?: string;
};

type InstalledRecord = {
  readonly name: string;
  readonly activeVersion: string;
  readonly rollbackVersion?: string;
  readonly provenance: PluginProvenance;
};

type SavedState = {
  readonly version: 1;
  readonly plugins: readonly InstalledRecord[];
};

type MutationAction = "install" | "update" | "rollback" | "remove";

type MutationJournal = {
  readonly version: 1;
  readonly id: string;
  readonly action: MutationAction;
  readonly name: string;
  readonly targetVersion?: string;
  readonly stagingDirectory?: string;
  readonly phase: "prepared" | "files-promoted" | "state-committed";
};

function isProvenance(value: unknown): value is PluginProvenance {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    item["source"] === "personal" &&
    typeof item["sourceId"] === "string" &&
    Boolean(item["sourceId"].trim())
  );
}

function isRecord(value: unknown): value is InstalledRecord {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["name"] === "string" &&
    typeof item["activeVersion"] === "string" &&
    (item["rollbackVersion"] === undefined ||
      typeof item["rollbackVersion"] === "string") &&
    isProvenance(item["provenance"])
  );
}

function isState(value: unknown): value is SavedState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    state["version"] === 1 &&
    Array.isArray(state["plugins"]) &&
    state["plugins"].every(isRecord)
  );
}

function isJournal(value: unknown): value is MutationJournal {
  if (typeof value !== "object" || value === null) return false;
  const journal = value as Record<string, unknown>;
  return (
    journal["version"] === 1 &&
    typeof journal["id"] === "string" &&
    ["install", "update", "rollback", "remove"].includes(
      journal["action"] as string,
    ) &&
    typeof journal["name"] === "string" &&
    (journal["targetVersion"] === undefined ||
      typeof journal["targetVersion"] === "string") &&
    (journal["stagingDirectory"] === undefined ||
      typeof journal["stagingDirectory"] === "string") &&
    ["prepared", "files-promoted", "state-committed"].includes(
      journal["phase"] as string,
    )
  );
}

function compareVersions(left: string, right: string): number {
  const numbers = (value: string) =>
    value
      .split(/[+-]/, 1)[0]
      ?.split(".")
      .map((part) => Number(part)) ?? [];
  const leftParts = numbers(left);
  const rightParts = numbers(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return difference;
  }
  return left.localeCompare(right);
}

function unavailable(message: string): PluginStoreError {
  return new PluginStoreError("unavailable", message);
}

export class FilePluginStore {
  readonly #root: string;
  readonly #stateFile: string;
  readonly #journalFile: string;
  #mutations: Promise<void> = Promise.resolve();
  #recovered = false;

  constructor(root: string) {
    this.#root = root;
    this.#stateFile = join(root, "state.json");
    this.#journalFile = join(root, "journal.json");
  }

  list(): Promise<readonly InstalledPlugin[]> {
    return this.#enqueue(() => this.#list());
  }

  install(
    sourceDirectory: string,
    provenance: PluginProvenance,
  ): Promise<void> {
    return this.#enqueue(() => this.#install(sourceDirectory, provenance));
  }

  update(name: string, sourceDirectory: string): Promise<void> {
    return this.#enqueue(() => this.#update(name, sourceDirectory));
  }

  rollback(name: string): Promise<void> {
    return this.#enqueue(() => this.#rollback(name));
  }

  remove(name: string): Promise<void> {
    return this.#enqueue(() => this.#remove(name));
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutations.then(operation);
    this.#mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #ensureRecovered(): Promise<void> {
    if (this.#recovered) return;
    await mkdir(this.#root, { recursive: true });
    const journal = await this.#readJournal();
    if (journal) {
      const state = await this.#readState();
      const current = state.plugins.find((item) => item.name === journal.name);
      if (
        (journal.action === "install" || journal.action === "update") &&
        journal.targetVersion &&
        current?.activeVersion !== journal.targetVersion
      )
        await rm(this.#versionDirectory(journal.name, journal.targetVersion), {
          recursive: true,
          force: true,
        });
      if (journal.action === "remove" && !current)
        await rm(this.#packageDirectory(journal.name), {
          recursive: true,
          force: true,
        });
      if (journal.stagingDirectory)
        await rm(join(this.#root, journal.stagingDirectory), {
          recursive: true,
          force: true,
        });
      await rm(this.#journalFile, { force: true });
    }
    this.#recovered = true;
  }

  async #list(): Promise<readonly InstalledPlugin[]> {
    await this.#ensureRecovered();
    const state = await this.#readState();
    const installed: InstalledPlugin[] = [];
    for (const record of state.plugins) {
      let plugin: PluginPackage;
      try {
        plugin = await loadPluginDirectory(
          this.#versionDirectory(record.name, record.activeVersion),
          record.provenance,
        );
      } catch {
        throw unavailable(
          `Installed plugin “${record.name}” is damaged and cannot be opened safely.`,
        );
      }
      if (
        plugin.manifest.name !== record.name ||
        plugin.manifest.version !== record.activeVersion
      )
        throw unavailable(
          `Installed plugin “${record.name}” does not match its installation record.`,
        );
      installed.push({
        package: plugin,
        activeVersion: record.activeVersion,
        ...(record.rollbackVersion
          ? { rollbackVersion: record.rollbackVersion }
          : {}),
      });
    }
    return installed;
  }

  async #install(
    sourceDirectory: string,
    provenance: PluginProvenance,
  ): Promise<void> {
    await this.#ensureRecovered();
    if (provenance.source !== "personal")
      throw new PluginStoreError(
        "unsupported",
        "A built-in plugin is not installed from a directory.",
      );
    const plugin = await loadPluginDirectory(sourceDirectory, provenance);
    const state = await this.#readState();
    if (state.plugins.some((item) => item.name === plugin.manifest.name))
      throw new PluginStoreError(
        "collision",
        `Plugin identity “${plugin.manifest.name}” is already owned.`,
      );
    await this.#promotePackage("install", sourceDirectory, plugin, state, {
      name: plugin.manifest.name,
      activeVersion: plugin.manifest.version,
      provenance,
    });
  }

  async #update(name: string, sourceDirectory: string): Promise<void> {
    await this.#ensureRecovered();
    const state = await this.#readState();
    const current = state.plugins.find((item) => item.name === name);
    if (!current)
      throw new PluginStoreError("notFound", "The plugin is not installed.");
    const plugin = await loadPluginDirectory(
      sourceDirectory,
      current.provenance,
    );
    if (plugin.manifest.name !== name)
      throw new PluginStoreError(
        "collision",
        "An update cannot replace a different plugin identity.",
      );
    if (compareVersions(plugin.manifest.version, current.activeVersion) <= 0)
      throw new PluginStoreError(
        "invalid",
        "An update must have a newer version than the installed plugin.",
      );
    await this.#promotePackage("update", sourceDirectory, plugin, state, {
      ...current,
      activeVersion: plugin.manifest.version,
      rollbackVersion: current.activeVersion,
    });
  }

  async #promotePackage(
    action: "install" | "update",
    sourceDirectory: string,
    plugin: PluginPackage,
    state: SavedState,
    next: InstalledRecord,
  ): Promise<void> {
    const id = randomUUID();
    const stagingDirectory = join("staging", id);
    const staging = join(this.#root, stagingDirectory);
    const target = this.#versionDirectory(
      plugin.manifest.name,
      plugin.manifest.version,
    );
    if (await lstat(target).catch(() => undefined))
      throw new PluginStoreError(
        "collision",
        `Plugin version “${plugin.manifest.version}” is already present.`,
      );
    await mkdir(join(this.#root, "staging"), { recursive: true });
    try {
      await cp(sourceDirectory, staging, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      const staged = await loadPluginDirectory(staging, next.provenance);
      if (
        staged.manifest.name !== plugin.manifest.name ||
        staged.manifest.version !== plugin.manifest.version
      )
        throw new PluginStoreError(
          "invalid",
          "The staged plugin changed while it was being installed.",
        );
      let journal: MutationJournal = {
        version: 1,
        id,
        action,
        name: plugin.manifest.name,
        targetVersion: plugin.manifest.version,
        stagingDirectory,
        phase: "prepared",
      };
      await this.#writeJournal(journal);
      await mkdir(this.#packageDirectory(plugin.manifest.name), {
        recursive: true,
      });
      await rename(staging, target);
      journal = { ...journal, phase: "files-promoted" };
      await this.#writeJournal(journal);
      const plugins = state.plugins.some((item) => item.name === next.name)
        ? state.plugins.map((item) => (item.name === next.name ? next : item))
        : [...state.plugins, next];
      await this.#writeState({ version: 1, plugins });
      await this.#writeJournal({ ...journal, phase: "state-committed" });
      await rm(this.#journalFile, { force: true });
    } catch (error) {
      if (
        error instanceof InvalidPluginError ||
        error instanceof PluginStoreError
      )
        throw error;
      throw unavailable(`Plugin “${plugin.manifest.name}” could not be saved.`);
    }
  }

  async #rollback(name: string): Promise<void> {
    await this.#ensureRecovered();
    const state = await this.#readState();
    const current = state.plugins.find((item) => item.name === name);
    if (!current)
      throw new PluginStoreError("notFound", "The plugin is not installed.");
    if (!current.rollbackVersion)
      throw new PluginStoreError(
        "notFound",
        "The plugin has no previous version to restore.",
      );
    if (
      !(await lstat(
        this.#versionDirectory(name, current.rollbackVersion),
      ).catch(() => undefined))
    )
      throw unavailable("The previous plugin version is unavailable.");
    const journal: MutationJournal = {
      version: 1,
      id: randomUUID(),
      action: "rollback",
      name,
      targetVersion: current.rollbackVersion,
      phase: "prepared",
    };
    await this.#writeJournal(journal);
    await this.#writeState({
      version: 1,
      plugins: state.plugins.map((item) =>
        item.name === name
          ? {
              ...item,
              activeVersion: current.rollbackVersion as string,
              rollbackVersion: current.activeVersion,
            }
          : item,
      ),
    });
    await this.#writeJournal({ ...journal, phase: "state-committed" });
    await rm(this.#journalFile, { force: true });
  }

  async #remove(name: string): Promise<void> {
    await this.#ensureRecovered();
    const state = await this.#readState();
    if (!state.plugins.some((item) => item.name === name))
      throw new PluginStoreError("notFound", "The plugin is not installed.");
    const journal: MutationJournal = {
      version: 1,
      id: randomUUID(),
      action: "remove",
      name,
      phase: "prepared",
    };
    await this.#writeJournal(journal);
    await this.#writeState({
      version: 1,
      plugins: state.plugins.filter((item) => item.name !== name),
    });
    await this.#writeJournal({ ...journal, phase: "state-committed" });
    await rm(this.#packageDirectory(name), { recursive: true, force: true });
    await rm(this.#journalFile, { force: true });
  }

  #packageDirectory(name: string): string {
    return join(this.#root, "packages", name);
  }

  #versionDirectory(name: string, version: string): string {
    return join(this.#packageDirectory(name), version);
  }

  async #readState(): Promise<SavedState> {
    let source: string;
    try {
      source = await readFile(this.#stateFile, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return { version: 1, plugins: [] };
      throw unavailable("Installed plugins could not be read.");
    }
    try {
      const value: unknown = JSON.parse(source);
      if (!isState(value)) throw new Error("Invalid plugin state");
      return value;
    } catch {
      throw unavailable(
        "Installed plugin state is damaged and cannot be opened safely.",
      );
    }
  }

  async #readJournal(): Promise<MutationJournal | undefined> {
    let source: string;
    try {
      source = await readFile(this.#journalFile, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return undefined;
      throw unavailable("Plugin recovery state could not be read.");
    }
    try {
      const value: unknown = JSON.parse(source);
      if (!isJournal(value)) throw new Error("Invalid plugin journal");
      return value;
    } catch {
      throw unavailable(
        "Plugin recovery state is damaged and cannot be applied safely.",
      );
    }
  }

  #writeState(state: SavedState): Promise<void> {
    return this.#writeJson(
      this.#stateFile,
      state,
      "Installed plugins could not be saved.",
    );
  }

  #writeJournal(journal: MutationJournal): Promise<void> {
    return this.#writeJson(
      this.#journalFile,
      journal,
      "Plugin recovery state could not be saved.",
    );
  }

  async #writeJson(
    path: string,
    value: unknown,
    message: string,
  ): Promise<void> {
    await mkdir(this.#root, { recursive: true });
    const temporary = `${path}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
      await rename(temporary, path);
    } catch {
      throw unavailable(message);
    }
  }
}
