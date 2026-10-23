/**
 * Zhiyin's Python environments as they lie on disk: one folder each, and
 * beside it a record of how it was made, which only Zhiyin writes. A package's
 * own install code may change its environment's folder but never the record,
 * so what a reset rebuilds is what the person approved.
 */

import {
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

/** The environment scripts run in when they name none, made on first use. */
export const defaultEnvironment = "default";

/** Short, lowercase, and never read as an option or a path. */
const environmentName = /^[a-z][a-z0-9-]{0,31}$/;

/** Names Windows keeps for devices, which no folder may have. */
const reservedName = /^(con|prn|aux|nul|com\d|lpt\d)$/;

/** A Python version as uv names one: 3.12, 3.13. */
const pythonVersion = /^3\.\d{1,2}$/;

/** Starts with a letter or digit, so it can never be read as an option. */
const packageName =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?([<>=!~]=?[^\s]+)?$/;

/** Why a name cannot be a new environment's, or nothing when it can. */
export function nameProblem(name: unknown): string | undefined {
  if (typeof name !== "string" || !environmentName.test(name))
    return "Name the environment with up to 32 lowercase letters, digits and dashes, starting with a letter.";
  if (reservedName.test(name))
    return `“${name}” is a name Windows keeps for itself; choose another.`;
  return undefined;
}

export function isPythonVersion(value: unknown): value is string {
  return typeof value === "string" && pythonVersion.test(value);
}

/** Packages named by name and version only, or nothing when one is not. */
export function packageList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every(
    (item) => typeof item === "string" && packageName.test(item),
  )
    ? (value as string[])
    : undefined;
}

/** How an environment was made, and whether its making finished. */
export type EnvironmentRecord = {
  readonly python: string;
  readonly packages: readonly string[];
  readonly ready: boolean;
};

/** A package installed in an environment, as its own metadata names it. */
type Installed = { readonly name: string; readonly version: string };

export class Environments {
  readonly #root: string;
  readonly #changes = new Map<string, Promise<unknown>>();

  constructor(root: string) {
    this.#root = root;
  }

  /**
   * The environment's folder. Only a name an environment can have makes a
   * path, so no name the model gives can lead out of the environments.
   */
  folder(name: string): string {
    if (nameProblem(name) !== undefined)
      throw new Error(`“${name}” cannot name an environment.`);
    return join(this.#root, name);
  }

  interpreter(name: string): string {
    return join(this.folder(name), "Scripts", "python.exe");
  }

  #recordFile(name: string): string {
    return `${this.folder(name)}.json`;
  }

  /** How it was made, or nothing when no environment has that name. */
  async record(name: string): Promise<EnvironmentRecord | undefined> {
    if (nameProblem(name) !== undefined) return undefined;
    const text = await readFile(this.#recordFile(name), "utf8").catch(
      () => undefined,
    );
    if (text === undefined) return undefined;
    try {
      const parsed = JSON.parse(text) as Partial<EnvironmentRecord>;
      const packages = packageList(parsed.packages);
      if (!isPythonVersion(parsed.python) || !packages) return undefined;
      return {
        python: parsed.python,
        packages,
        ready: parsed.ready === true,
      };
    } catch {
      return undefined;
    }
  }

  async keepRecord(name: string, record: EnvironmentRecord): Promise<void> {
    await writeFile(this.#recordFile(name), JSON.stringify(record), "utf8");
  }

  /** Whether scripts can run in it: its making finished and its Python is there. */
  async isReady(name: string): Promise<boolean> {
    return (
      (await this.record(name))?.ready === true &&
      Boolean(await stat(this.interpreter(name)).catch(() => undefined))
    );
  }

  /** Every environment with a record, finished or not, by name. */
  async names(): Promise<string[]> {
    const entries = await readdir(this.#root).catch(() => [] as string[]);
    return entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -".json".length))
      .filter((name) => nameProblem(name) === undefined)
      .sort();
  }

  /** Deletes the folder, marking the environment unfinished until it is gone. */
  async remove(name: string): Promise<void> {
    const record = await this.record(name);
    if (record) await this.keepRecord(name, { ...record, ready: false });
    await rm(this.folder(name), { recursive: true, force: true });
    await rm(this.#recordFile(name), { force: true });
  }

  /**
   * The Python version the environment runs. uv makes it from a link named
   * by the minor version, which leads to the folder of the Python whose
   * patch version it is; its settings name only the minor version.
   */
  async pythonOf(name: string): Promise<string | undefined> {
    const settings = await readFile(
      join(this.folder(name), "pyvenv.cfg"),
      "utf8",
    ).catch(() => "");
    const home = /^home\s*=\s*(.+?)\s*$/m.exec(settings)?.[1];
    const python = home
      ? await realpath(home).catch(() => undefined)
      : undefined;
    return (
      (python && /cpython-(\d+\.\d+\.\d+)/.exec(basename(python))?.[1]) ??
      /^version_info\s*=\s*(.+?)\s*$/m.exec(settings)?.[1]
    );
  }

  /** What is installed, read from each package's metadata, running nothing. */
  async installed(name: string): Promise<Installed[]> {
    const packages = join(this.folder(name), "Lib", "site-packages");
    const entries = await readdir(packages).catch(() => [] as string[]);
    const found: Installed[] = [];
    for (const entry of entries.filter((entry) =>
      entry.endsWith(".dist-info"),
    )) {
      const metadata = await readFile(
        join(packages, entry, "METADATA"),
        "utf8",
      ).catch(() => "");
      const field = (key: string) =>
        new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m").exec(metadata)?.[1];
      const packageName = field("Name");
      const version = field("Version");
      if (packageName && version) found.push({ name: packageName, version });
    }
    return found.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  }

  /**
   * Runs one change of an environment after the changes asked for before it,
   * so two never build, install into or delete the same folder at once.
   */
  oneAtATime<T>(name: string, change: () => Promise<T>): Promise<T> {
    const before = this.#changes.get(name) ?? Promise.resolve();
    const next = before.then(change, change);
    this.#changes.set(name, next);
    const settle = () => {
      if (this.#changes.get(name) === next) this.#changes.delete(name);
    };
    next.then(settle, settle);
    return next;
  }
}
