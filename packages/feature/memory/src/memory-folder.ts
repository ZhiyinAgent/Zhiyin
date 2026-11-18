/**
 * The memory folder as files (ADR 0026):
 *
 *     everything\about-you.md, how-to-work.md, knowledge\*.md
 *     projects\<folder>\project.json, how-to-work.md, brief.md, knowledge\*.md
 *     conversations\<conversation>\brief.md, knowledge\*.md, for a
 *               conversation outside any project (ADR 0026)
 *     .zhiyin\  what Zhiyin keeps for itself: the next number, the writes
 *               it can take back, the changes waiting for the person
 *
 * An entry's place is its scope and section, so a file moved by hand moves
 * the entry. Every read looks at the files again and rereads those that
 * changed, so an edit made outside Zhiyin holds at once. A file with no number,
 * or with a number another file already has, is given a new one.
 */

import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import {
  everythingScope,
  type MemoryEntry,
  type MemoryProject,
  type MemorySection,
} from "@zhiyin/contract";
import { replaceFile } from "@zhiyin/files";
import { portableNameFor } from "@zhiyin/text-and-names";
import {
  conversationOfScope,
  conversationScope,
} from "@zhiyin/memory-projects";
import { readEntry, writeEntry, type EntryFields } from "./entry-file.js";

/** An entry, and the file it is kept in. */
export type StoredEntry = MemoryEntry & { readonly path: string };

/** A project, and its folder under `projects`. */
export type StoredProject = MemoryProject & { readonly folder: string };

export type Snapshot = {
  readonly entries: readonly StoredEntry[];
  readonly projects: readonly StoredProject[];
  readonly off: boolean;
};

/** The fixed files of a scope, by section. */
const fixedFiles: Partial<Record<MemorySection, string>> = {
  about: "about-you.md",
  how: "how-to-work.md",
  brief: "brief.md",
};

export const sectionTitles: Record<MemorySection, string> = {
  about: "About you",
  how: "How to work",
  brief: "Brief",
  knowledge: "Knowledge",
};

type State = { readonly next: number; readonly off?: true };

type Cached = {
  readonly modified: number;
  readonly size: number;
  readonly fields: EntryFields;
};

/** Which fixed files a scope holds: About you for everything alone, How to work for no conversation, a brief for no everything. */
function holds(scope: string, section: MemorySection): boolean {
  if (section === "about") return scope === everythingScope;
  if (section === "how") return !conversationOfScope(scope);
  return section !== "brief" || scope !== everythingScope;
}

/** A conversation's id as its folder's name: ids are plain, and anything else is refused. */
function conversationFolder(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error(`A conversation's id is not a folder name: ${id}`);
  return id;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function namesIn(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder, { withFileTypes: true }))
      .filter(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
      )
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

async function foldersIn(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

export class MemoryFolder {
  readonly root: string;
  readonly #now: () => Date;
  readonly #cache = new Map<string, Cached>();

  constructor(root: string, now: () => Date) {
    this.root = root;
    this.#now = now;
  }

  get #own(): string {
    return join(this.root, ".zhiyin");
  }

  /** Where a scope's files are. */
  scopeFolder(scope: string, projects: readonly StoredProject[]): string {
    if (scope === everythingScope) return join(this.root, "everything");
    const conversation = conversationOfScope(scope);
    if (conversation)
      return join(this.root, "conversations", conversationFolder(conversation));
    const project = projects.find((one) => one.id === scope);
    if (!project) throw new Error(`No project ${scope} is kept.`);
    return join(this.root, "projects", project.folder);
  }

  /** Makes the folder, if nothing has made it yet. */
  async make(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  /** Every entry and project as the files now stand. */
  async read(): Promise<Snapshot> {
    const projects = await this.#projects();
    const found: {
      scope: string;
      section: MemorySection;
      path: string;
      name: string;
    }[] = [];
    const scopes = [
      { scope: everythingScope, folder: join(this.root, "everything") },
      ...projects.map((project) => ({
        scope: project.id,
        folder: join(this.root, "projects", project.folder),
      })),
      ...(await foldersIn(join(this.root, "conversations")))
        .filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
        .map((name) => ({
          scope: conversationScope(name),
          folder: join(this.root, "conversations", name),
        })),
    ];
    for (const { scope, folder } of scopes) {
      const names = new Set(await namesIn(folder));
      for (const [section, name] of Object.entries(fixedFiles) as [
        MemorySection,
        string,
      ][]) {
        if (holds(scope, section) && names.has(name))
          found.push({ scope, section, path: join(folder, name), name });
      }
      for (const name of await namesIn(join(folder, "knowledge")))
        found.push({
          scope,
          section: "knowledge",
          path: join(folder, "knowledge", name),
          name,
        });
    }
    const read: {
      scope: string;
      section: MemorySection;
      path: string;
      fields: EntryFields;
    }[] = [];
    for (const one of found) {
      const fields = await this.#fields(
        one.path,
        one.name.replace(/\.md$/i, ""),
      );
      if (fields) read.push({ ...one, fields });
    }
    const entries = await this.#numbered(read);
    return { entries, projects, off: (await this.#state()).off === true };
  }

  async #fields(path: string, name: string): Promise<EntryFields | undefined> {
    try {
      const { mtimeMs, size } = await stat(path);
      const cached = this.#cache.get(path);
      if (cached && cached.modified === mtimeMs && cached.size === size)
        return cached.fields;
      const fields = readEntry(await readFile(path, "utf8"), name);
      this.#cache.set(path, { modified: mtimeMs, size, fields });
      return fields;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  /**
   * The entries with their numbers: a file without one, or sharing one with a
   * file read before it, is given the next and written again.
   */
  async #numbered(
    read: readonly {
      scope: string;
      section: MemorySection;
      path: string;
      fields: EntryFields;
    }[],
  ): Promise<StoredEntry[]> {
    const taken = new Set<number>();
    const entries: StoredEntry[] = [];
    const later: (typeof read)[number][] = [];
    for (const one of read) {
      const number = one.fields.number;
      if (number === undefined || taken.has(number)) later.push(one);
      else {
        taken.add(number);
        entries.push(this.#entry(one, number));
      }
    }
    const highest = Math.max(0, ...taken);
    if (later.length && (await this.#state()).next <= highest)
      await this.#saveState({ next: highest + 1 });
    for (const one of later) {
      const number = await this.nextNumber(highest);
      const entry = this.#entry(one, number);
      await this.#writeFile(entry.path, entry);
      entries.push(entry);
    }
    return entries.sort((one, other) => one.number - other.number);
  }

  #entry(
    one: {
      scope: string;
      section: MemorySection;
      path: string;
      fields: EntryFields;
    },
    number: number,
  ): StoredEntry {
    const { fields } = one;
    return {
      number,
      scope: one.scope,
      section: one.section,
      title:
        one.section === "knowledge" ? fields.title : sectionTitles[one.section],
      summary: fields.summary,
      text: fields.text,
      written: fields.written ?? this.#now().toISOString(),
      ...(fields.used ? { used: fields.used } : {}),
      ...(fields.conversation ? { conversation: fields.conversation } : {}),
      ...(fields.held ? { held: fields.held } : {}),
      path: one.path,
    };
  }

  /** A number never given before, at least above `above`. */
  async nextNumber(above = 0): Promise<number> {
    const state = await this.#state();
    const number = Math.max(state.next, above + 1);
    await this.#saveState({ ...state, next: number + 1 });
    return number;
  }

  /** Where an entry is kept, by its scope, section, number and title. */
  pathFor(
    entry: Pick<MemoryEntry, "scope" | "section" | "number" | "title">,
    projects: readonly StoredProject[],
  ): string {
    const folder = this.scopeFolder(entry.scope, projects);
    const fixed = fixedFiles[entry.section];
    if (fixed) return join(folder, fixed);
    return join(
      folder,
      "knowledge",
      `${entry.number} ${portableNameFor(entry.title, "entry")}.md`,
    );
  }

  /** Writes an entry where it belongs, removing the file it was kept in when that differs. */
  async save(
    entry: MemoryEntry,
    projects: readonly StoredProject[],
    was?: string,
  ): Promise<StoredEntry> {
    const path = this.pathFor(entry, projects);
    await this.#writeFile(path, entry);
    if (was && was.toLowerCase() !== path.toLowerCase()) await this.forget(was);
    return { ...entry, path };
  }

  async #writeFile(path: string, entry: MemoryEntry): Promise<void> {
    await mkdir(join(path, ".."), { recursive: true });
    await replaceFile(path, writeEntry(entry, entry.section));
    this.#cache.delete(path);
  }

  /** Removes an entry's file. */
  async forget(path: string): Promise<void> {
    await rm(path, { force: true });
    this.#cache.delete(path);
  }

  async #projects(): Promise<StoredProject[]> {
    const projects: StoredProject[] = [];
    for (const folder of await foldersIn(join(this.root, "projects"))) {
      const kept = await this.readJson<Partial<MemoryProject>>(
        join(this.root, "projects", folder, "project.json"),
      );
      projects.push({
        id: typeof kept?.id === "string" && kept.id ? kept.id : folder,
        name: typeof kept?.name === "string" && kept.name ? kept.name : folder,
        folders: Array.isArray(kept?.folders)
          ? kept.folders.filter((one): one is string => typeof one === "string")
          : [],
        ...(kept?.archived === true ? { archived: true as const } : {}),
        ...(Array.isArray(kept?.merged)
          ? {
              merged: kept.merged.filter(
                (one): one is string => typeof one === "string",
              ),
            }
          : {}),
        created:
          typeof kept?.created === "string"
            ? kept.created
            : this.#now().toISOString(),
        folder,
      });
    }
    return projects.sort((one, other) =>
      one.created.localeCompare(other.created),
    );
  }

  /** Writes a project's own file, making its folder when it is new. */
  async saveProject(project: StoredProject): Promise<void> {
    const { folder, ...kept } = project;
    await this.writeJson(
      join(this.root, "projects", folder, "project.json"),
      kept,
    );
  }

  /** A folder name under `projects` for a new project called `name`. */
  async projectFolderFor(name: string): Promise<string> {
    const taken = new Set(
      (await foldersIn(join(this.root, "projects"))).map((one) =>
        one.toLowerCase(),
      ),
    );
    const base = portableNameFor(name, "project");
    for (let count = 1; ; count += 1) {
      const folder = count === 1 ? base : `${base}-${count}`;
      if (!taken.has(folder)) return folder;
    }
  }

  /** Moves everything in one project's folder into another's. */
  async moveProjectFiles(from: string, into: string): Promise<void> {
    const source = join(this.root, "projects", from);
    const target = join(this.root, "projects", into);
    for (const name of await namesIn(join(source, "knowledge"))) {
      await mkdir(join(target, "knowledge"), { recursive: true });
      await rename(
        join(source, "knowledge", name),
        join(target, "knowledge", name),
      );
    }
    for (const name of await namesIn(source))
      await rename(join(source, name), join(target, name));
  }

  /**
   * Removes a conversation's folder once nothing is left in it; a file the
   * person put there that is not an entry keeps it.
   */
  async dropConversationFolder(conversationId: string): Promise<void> {
    const folder = join(
      this.root,
      "conversations",
      conversationFolder(conversationId),
    );
    for (const empty of [join(folder, "knowledge"), folder])
      await rmdir(empty).catch(() => undefined);
  }

  projectPath(folder: string): string {
    return join(this.root, "projects", folder);
  }

  async #state(): Promise<State> {
    const kept = await this.readJson<Partial<State>>(
      join(this.#own, "state.json"),
    );
    return {
      next: typeof kept?.next === "number" && kept.next > 0 ? kept.next : 1,
      ...(kept?.off === true ? { off: true as const } : {}),
    };
  }

  async #saveState(state: State): Promise<void> {
    await this.writeJson(join(this.#own, "state.json"), state);
  }

  async switch(on: boolean): Promise<void> {
    const { next } = await this.#state();
    await this.#saveState(on ? { next } : { next, off: true });
  }

  /** Zhiyin's own record named `name` in `kind`, or nothing. */
  ownRecord<Value>(
    kind: "writes" | "waiting",
    name: string,
  ): Promise<Value | undefined> {
    return this.readJson<Value>(join(this.#own, kind, `${name}.json`));
  }

  async keepOwnRecord(
    kind: "writes" | "waiting",
    name: string,
    value: unknown,
  ): Promise<void> {
    await this.writeJson(join(this.#own, kind, `${name}.json`), value);
  }

  /**
   * Keeps the record that takes a write back, then makes the write, so no
   * write is left without its record. A write that fails drops its record.
   */
  async recordedWrite<Value>(
    name: string,
    record: unknown,
    write: () => Promise<Value>,
  ): Promise<Value> {
    await this.keepOwnRecord("writes", name, record);
    try {
      return await write();
    } catch (error) {
      await this.dropOwnRecord("writes", name).catch(() => undefined);
      throw error;
    }
  }

  async dropOwnRecord(kind: "writes" | "waiting", name: string): Promise<void> {
    await rm(join(this.#own, kind, `${name}.json`), { force: true });
  }

  async ownRecords<Value>(kind: "writes" | "waiting"): Promise<Value[]> {
    const folder = join(this.#own, kind);
    let names: string[];
    try {
      names = (await readdir(folder))
        .filter((name) => name.endsWith(".json"))
        .sort();
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    const records: Value[] = [];
    for (const name of names) {
      const value = await this.readJson<Value>(join(folder, name));
      if (value !== undefined) records.push(value);
    }
    return records;
  }

  async readJson<Value>(path: string): Promise<Value | undefined> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as Value;
    } catch (error) {
      if (missing(error) || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(join(path, ".."), { recursive: true });
    await replaceFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }
}
