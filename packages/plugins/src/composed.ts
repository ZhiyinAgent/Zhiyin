import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthoredPluginContents } from "@zhiyin/contract";
import {
  AUTHORED,
  InvalidPluginError,
  LOCAL_IMPORT,
  portableName,
  type ComponentContent,
  type ComponentView,
  type PluginPackage,
  type PluginView,
  type Plugins,
} from "./index.js";
import { PluginStoreError } from "./errors.js";
import { loadPluginDirectory } from "./package-loader.js";
import { writePluginDirectory } from "./package-writer.js";
import {
  contentFingerprint,
  type FilePluginSettings,
  type PluginSettingsState,
} from "./settings.js";
import type { FilePluginStore } from "./store.js";

export function slugifyPluginName(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  if (!slug || !portableName.test(slug))
    throw new InvalidPluginError("A plugin needs a name.");
  return slug;
}

function bumpPatch(version: string): string {
  const [major = "0", minor = "0", patch = "0"] = version
    .split(/[+-]/, 1)[0]!
    .split(".");
  return [major, minor, String((Number(patch) || 0) + 1)].join(".");
}

type Entry = {
  readonly plugin: PluginPackage;
  readonly rollbackVersion?: string;
};

type EditableContent = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
};

type EditableKind = "skill" | "specialist";

/** A specialist's name is part of its content; a skill's name is its id. */
function shippedFingerprint(
  component: EditableContent,
  kind: EditableKind,
): string {
  return contentFingerprint({
    ...(kind === "specialist" ? { name: component.name } : {}),
    description: component.description,
    instructions: component.instructions,
  });
}

function withChoices<T extends EditableContent>(
  component: T,
  kind: EditableKind,
  settings: PluginSettingsState,
  overridable: boolean,
): T & ComponentView {
  const enabled = !settings.disabledComponents.has(component.id);
  const override = overridable
    ? settings.overrides.get(component.id)
    : undefined;
  if (!override) return { ...component, enabled };
  return {
    ...component,
    ...(kind === "specialist" && override.name !== undefined
      ? { name: override.name }
      : {}),
    description: override.description,
    instructions: override.instructions,
    enabled,
    override: {
      shippedChanged: shippedFingerprint(component, kind) !== override.replaces,
      shipped: {
        name: component.name,
        description: component.description,
        instructions: component.instructions,
      },
    },
  };
}

function view(entry: Entry, settings: PluginSettingsState): PluginView {
  const { plugin } = entry;
  const editing =
    plugin.provenance.source === "personal" &&
    plugin.provenance.sourceId === AUTHORED.sourceId
      ? "authored"
      : "override";
  const overridable = editing === "override";
  const enabled = (id: string) => !settings.disabledComponents.has(id);
  return {
    manifest: plugin.manifest,
    provenance: plugin.provenance,
    enabled: !settings.disabledPlugins.has(plugin.manifest.name),
    editing,
    ...(entry.rollbackVersion
      ? { rollbackVersion: entry.rollbackVersion }
      : {}),
    skills: plugin.skills.map((skill) =>
      withChoices(skill, "skill", settings, overridable),
    ),
    specialists: plugin.specialists.map((specialist) =>
      withChoices(specialist, "specialist", settings, overridable),
    ),
    mcpServers: plugin.mcpServers.map((server) => ({
      ...server,
      enabled: enabled(server.id),
    })),
    appConnectors: plugin.appConnectors.map((connector) => ({
      ...connector,
      enabled: enabled(connector.id),
    })),
  };
}

function componentIds(plugin: PluginPackage): string[] {
  return [
    ...plugin.skills,
    ...plugin.specialists,
    ...plugin.mcpServers,
    ...plugin.appConnectors,
  ].map((component) => component.id);
}

const builtInRefusal = (action: string) =>
  new PluginStoreError("unsupported", `A built-in plugin cannot be ${action}.`);

/**
 * The shipped catalog and a person's installed packages behind one
 * interface, with the choices kept about them. Every change is serialized
 * here, and each change that can make a component disappear forgets the
 * choices kept for it in the same step.
 */
export class ComposedPlugins implements Plugins {
  readonly #loadBuiltIns: () => Promise<readonly PluginPackage[]>;
  readonly #store: FilePluginStore;
  readonly #settings: FilePluginSettings;
  #builtIns: Promise<readonly PluginPackage[]> | undefined;
  #mutations: Promise<void> = Promise.resolve();
  #reconciled = false;

  constructor(options: {
    readonly builtIns: () => Promise<readonly PluginPackage[]>;
    readonly store: FilePluginStore;
    readonly settings: FilePluginSettings;
  }) {
    this.#loadBuiltIns = options.builtIns;
    this.#store = options.store;
    this.#settings = options.settings;
  }

  async list(): Promise<readonly PluginView[]> {
    if (!this.#reconciled) await this.#serial(() => this.#reconcile());
    const [entries, settings] = await Promise.all([
      this.#entries(),
      this.#settings.read(),
    ]);
    return entries.map((entry) => view(entry, settings));
  }

  async builtInNames(): Promise<readonly string[]> {
    return (await this.#builtInPackages()).map(
      (plugin) => plugin.manifest.name,
    );
  }

  setEnabled(name: string, enabled: boolean): Promise<void> {
    return this.#serial(async () => {
      await this.#requireEntry(name);
      await this.#settings.setPluginEnabled(name, enabled);
    });
  }

  setComponentEnabled(id: string, enabled: boolean): Promise<void> {
    return this.#serial(async () => {
      const entries = await this.#entries();
      if (!entries.some((entry) => componentIds(entry.plugin).includes(id)))
        throw new PluginStoreError(
          "notFound",
          `Component “${id}” does not exist.`,
        );
      await this.#settings.setComponentEnabled(id, enabled);
    });
  }

  overrideComponent(id: string, content: ComponentContent): Promise<void> {
    return this.#serial(async () => {
      const { shipped, kind } = await this.#editable(id);
      if (!content.description.trim() || !content.instructions.trim())
        throw new InvalidPluginError(
          "A component needs a description and instructions.",
        );
      const name = content.name?.trim();
      if (kind === "specialist" && !name)
        throw new InvalidPluginError("A specialist needs a name.");
      const edited: EditableContent = {
        id,
        name: kind === "specialist" ? name! : shipped.name,
        description: content.description.trim(),
        instructions: content.instructions.trim(),
      };
      const replaces = shippedFingerprint(shipped, kind);
      if (shippedFingerprint(edited, kind) === replaces) {
        await this.#settings.clearOverride(id);
        return;
      }
      await this.#settings.setOverride(id, {
        ...(kind === "specialist" ? { name: edited.name } : {}),
        description: edited.description,
        instructions: edited.instructions,
        replaces,
      });
    });
  }

  resetComponent(id: string): Promise<void> {
    return this.#serial(async () => {
      await this.#editable(id);
      await this.#settings.clearOverride(id);
    });
  }

  install(sourceDirectory: string): Promise<void> {
    return this.#serial(async () => {
      const incoming = await loadPluginDirectory(sourceDirectory, LOCAL_IMPORT);
      await this.#refuseBuiltInName(incoming.manifest.name);
      await this.#store.install(sourceDirectory, LOCAL_IMPORT);
    });
  }

  update(name: string, sourceDirectory: string): Promise<void> {
    return this.#serial(async () => {
      const entry = await this.#installed(name, "updated");
      if (entry.plugin.provenance.sourceId === AUTHORED.sourceId)
        throw new PluginStoreError(
          "unsupported",
          "A plugin made in Zhiyin is edited here, not updated from a folder.",
        );
      await this.#store.update(name, sourceDirectory);
      await this.#reconcile();
    });
  }

  rollback(name: string): Promise<void> {
    return this.#serial(async () => {
      await this.#installed(name, "rolled back");
      await this.#store.rollback(name);
      await this.#reconcile();
    });
  }

  remove(name: string): Promise<void> {
    return this.#serial(async () => {
      await this.#installed(name, "removed");
      await this.#store.remove(name);
      await this.#settings.forgetPlugin(name);
    });
  }

  create(displayName: string, description: string): Promise<void> {
    return this.#serial(async () => {
      const name = slugifyPluginName(displayName);
      if (!description.trim())
        throw new InvalidPluginError("A plugin needs a description.");
      await this.#refuseBuiltInName(name);
      await this.#withDirectory(async (directory) => {
        await writePluginDirectory(directory, {
          name,
          displayName: displayName.trim(),
          version: "0.0.1",
          description: description.trim(),
          skills: [],
          specialists: [],
          mcpServers: [],
        });
        await this.#store.install(directory, AUTHORED);
      });
    });
  }

  saveContents(name: string, contents: AuthoredPluginContents): Promise<void> {
    return this.#serial(async () => {
      const entry = await this.#installed(name, "edited");
      if (entry.plugin.provenance.sourceId !== AUTHORED.sourceId)
        throw new PluginStoreError(
          "unsupported",
          "Only a plugin made in Zhiyin is edited as a whole; change its components one at a time instead.",
        );
      await this.#withDirectory(async (directory) => {
        await writePluginDirectory(directory, {
          name,
          displayName: contents.displayName,
          version: bumpPatch(entry.plugin.manifest.version),
          description: contents.description,
          skills: contents.skills,
          specialists: contents.specialists,
          mcpServers: contents.mcpServers,
        });
        await this.#store.update(name, directory);
      });
      await this.#reconcile();
    });
  }

  #builtInPackages(): Promise<readonly PluginPackage[]> {
    this.#builtIns ??= this.#loadBuiltIns().catch((error: unknown) => {
      this.#builtIns = undefined;
      throw error;
    });
    return this.#builtIns;
  }

  async #entries(): Promise<readonly Entry[]> {
    const [builtIns, installed] = await Promise.all([
      this.#builtInPackages(),
      this.#store.list(),
    ]);
    return [
      ...builtIns.map((plugin) => ({ plugin })),
      ...installed.map((item) => ({
        plugin: item.package,
        ...(item.rollbackVersion
          ? { rollbackVersion: item.rollbackVersion }
          : {}),
      })),
    ];
  }

  async #requireEntry(name: string): Promise<Entry> {
    const entry = (await this.#entries()).find(
      (item) => item.plugin.manifest.name === name,
    );
    if (!entry)
      throw new PluginStoreError(
        "notFound",
        `Plugin “${name}” does not exist.`,
      );
    return entry;
  }

  async #installed(name: string, action: string): Promise<Entry> {
    const entry = await this.#requireEntry(name);
    if (entry.plugin.provenance.source === "built-in")
      throw builtInRefusal(action);
    return entry;
  }

  async #refuseBuiltInName(name: string): Promise<void> {
    if ((await this.#builtInPackages()).some((p) => p.manifest.name === name))
      throw new PluginStoreError(
        "collision",
        `Plugin identity “${name}” is already owned by a built-in plugin.`,
      );
  }

  async #editable(id: string): Promise<{
    readonly kind: EditableKind;
    readonly shipped: EditableContent;
  }> {
    for (const { plugin } of await this.#entries()) {
      const skill = plugin.skills.find((item) => item.id === id);
      const specialist = plugin.specialists.find((item) => item.id === id);
      const shipped = skill ?? specialist;
      if (!shipped) {
        if (componentIds(plugin).includes(id))
          throw new PluginStoreError(
            "unsupported",
            "A connector's content cannot be edited.",
          );
        continue;
      }
      if (plugin.provenance.sourceId === AUTHORED.sourceId)
        throw new PluginStoreError(
          "unsupported",
          "A plugin made in Zhiyin is edited directly.",
        );
      return { kind: skill ? "skill" : "specialist", shipped };
    }
    throw new PluginStoreError("notFound", `Component “${id}” does not exist.`);
  }

  /** Forgets choices about anything no longer installed or declared. */
  async #reconcile(): Promise<void> {
    const entries = await this.#entries();
    await this.#settings.retain(
      new Set(entries.map((entry) => entry.plugin.manifest.name)),
      new Set(entries.flatMap((entry) => componentIds(entry.plugin))),
    );
    this.#reconciled = true;
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutations.then(operation);
    this.#mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #withDirectory(
    operation: (directory: string) => Promise<void>,
  ): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-plugin-authoring-"));
    try {
      await operation(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
