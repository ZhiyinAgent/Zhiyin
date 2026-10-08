import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComponentContent } from "./plugins.js";
import { PluginStoreError } from "./errors.js";

/** A person's content edit, with a fingerprint of the content it replaced. */
export type StoredOverride = ComponentContent & { readonly replaces: string };

export type PluginSettingsState = {
  readonly disabledPlugins: ReadonlySet<string>;
  readonly disabledComponents: ReadonlySet<string>;
  readonly overrides: ReadonlyMap<string, StoredOverride>;
};

type SavedSettings = {
  readonly version: 1;
  readonly disabledPlugins: readonly string[];
  readonly disabledComponents: readonly string[];
  readonly overrides: Readonly<Record<string, StoredOverride>>;
};

const empty: SavedSettings = {
  version: 1,
  disabledPlugins: [],
  disabledComponents: [],
  overrides: {},
};

/** Identifies shipped content, so an override can tell when it has changed. */
export function contentFingerprint(content: ComponentContent): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        content.name ?? "",
        content.description,
        content.instructions,
      ]),
    )
    .digest("hex");
}

function isStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isOverride(value: unknown): value is StoredOverride {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (item["name"] === undefined || typeof item["name"] === "string") &&
    typeof item["description"] === "string" &&
    typeof item["instructions"] === "string" &&
    typeof item["replaces"] === "string"
  );
}

function isSaved(value: unknown): value is SavedSettings {
  if (typeof value !== "object" || value === null) return false;
  const saved = value as Record<string, unknown>;
  const overrides = saved["overrides"];
  return (
    saved["version"] === 1 &&
    isStrings(saved["disabledPlugins"]) &&
    isStrings(saved["disabledComponents"]) &&
    typeof overrides === "object" &&
    overrides !== null &&
    !Array.isArray(overrides) &&
    Object.values(overrides).every(isOverride)
  );
}

/**
 * What a person chose about packages, kept apart from the packages so that a
 * choice never needs a new package version: which plugins and components are
 * off, and which component contents they replaced. Mutations are serialized
 * and written atomically.
 */
export class FilePluginSettings {
  readonly #directory: string;
  readonly #file: string;
  #mutations: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.#directory = directory;
    this.#file = join(directory, "plugin-settings.json");
  }

  async read(): Promise<PluginSettingsState> {
    await this.#mutations;
    const saved = await this.#read();
    return {
      disabledPlugins: new Set(saved.disabledPlugins),
      disabledComponents: new Set(saved.disabledComponents),
      overrides: new Map(Object.entries(saved.overrides)),
    };
  }

  setPluginEnabled(name: string, enabled: boolean): Promise<void> {
    return this.#change((saved) => ({
      ...saved,
      disabledPlugins: toggled(saved.disabledPlugins, name, !enabled),
    }));
  }

  setComponentEnabled(id: string, enabled: boolean): Promise<void> {
    return this.#change((saved) => ({
      ...saved,
      disabledComponents: toggled(saved.disabledComponents, id, !enabled),
    }));
  }

  setOverride(id: string, override: StoredOverride): Promise<void> {
    return this.#change((saved) => ({
      ...saved,
      overrides: { ...saved.overrides, [id]: override },
    }));
  }

  clearOverride(id: string): Promise<void> {
    return this.#change((saved) => ({
      ...saved,
      overrides: Object.fromEntries(
        Object.entries(saved.overrides).filter(([key]) => key !== id),
      ),
    }));
  }

  /**
   * Forgets every choice about a plugin or component that no longer exists.
   * Writes nothing when there is nothing to forget.
   */
  retain(plugins: ReadonlySet<string>, components: ReadonlySet<string>) {
    return this.#change((saved) => {
      const next: SavedSettings = {
        version: 1,
        disabledPlugins: saved.disabledPlugins.filter((name) =>
          plugins.has(name),
        ),
        disabledComponents: saved.disabledComponents.filter((id) =>
          components.has(id),
        ),
        overrides: Object.fromEntries(
          Object.entries(saved.overrides).filter(([id]) => components.has(id)),
        ),
      };
      return next.disabledPlugins.length === saved.disabledPlugins.length &&
        next.disabledComponents.length === saved.disabledComponents.length &&
        Object.keys(next.overrides).length ===
          Object.keys(saved.overrides).length
        ? saved
        : next;
    });
  }

  /** Forgets everything kept for one plugin and its components. */
  forgetPlugin(name: string): Promise<void> {
    const owned = (id: string) => id.startsWith(`${name}/`);
    return this.#change((saved) => ({
      version: 1,
      disabledPlugins: saved.disabledPlugins.filter((item) => item !== name),
      disabledComponents: saved.disabledComponents.filter((id) => !owned(id)),
      overrides: Object.fromEntries(
        Object.entries(saved.overrides).filter(([id]) => !owned(id)),
      ),
    }));
  }

  #change(update: (saved: SavedSettings) => SavedSettings): Promise<void> {
    const result = this.#mutations.then(async () => {
      const saved = await this.#read();
      const next = update(saved);
      if (next !== saved) await this.#write(next);
    });
    this.#mutations = result.catch(() => undefined);
    return result;
  }

  async #read(): Promise<SavedSettings> {
    let source: string;
    try {
      source = await readFile(this.#file, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return empty;
      throw new PluginStoreError(
        "unavailable",
        "Plugin settings could not be read.",
      );
    }
    try {
      const value: unknown = JSON.parse(source);
      if (!isSaved(value)) throw new Error("Invalid plugin settings");
      return value;
    } catch {
      throw new PluginStoreError(
        "unavailable",
        "Plugin settings are damaged and cannot be opened safely.",
      );
    }
  }

  async #write(settings: SavedSettings): Promise<void> {
    const temporary = `${this.#file}.tmp`;
    try {
      await mkdir(this.#directory, { recursive: true });
      await writeFile(temporary, JSON.stringify(settings, null, 2), "utf8");
      await rename(temporary, this.#file);
    } catch {
      throw new PluginStoreError(
        "unavailable",
        "Plugin settings could not be saved.",
      );
    }
  }
}

function toggled(
  values: readonly string[],
  value: string,
  present: boolean,
): readonly string[] {
  const rest = values.filter((item) => item !== value);
  return present ? [...rest, value].sort() : rest;
}
