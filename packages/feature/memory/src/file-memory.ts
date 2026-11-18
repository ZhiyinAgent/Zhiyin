import { conversationScope } from "@zhiyin/memory-projects";
import { Serial } from "@zhiyin/one-at-a-time";
import {
  everythingScope,
  memoryLimits,
  type MemoryDraft,
  type MemoryEdit,
  type MemoryEntry,
  type MemoryProject,
  type MemoryState,
  type MemoryWaiting,
} from "@zhiyin/contract";
import type {
  EntryLine,
  Memory,
  MemoryStart,
  PersonsOutcome,
  RecallOutcome,
  RememberOutcome,
  WriteContext,
} from "./memory.js";
import { MemoryFolder, type StoredEntry } from "./memory-folder.js";
import {
  mostSearches,
  readRecall,
  readRemember,
  recallTool,
  rememberToolFor,
} from "./tools.js";
import {
  applyRemember,
  leastUsedLines,
  scopeForModel,
} from "./model-writes.js";
import { carryConversation } from "./carry.js";
import { listLine } from "./limits.js";
import { Closeness } from "./similarity.js";
import { linkLines, linkedFrom } from "./links.js";
import {
  knownText,
  personsInstructions,
  projectInstructions,
} from "./start.js";
import { projectHolding } from "./folders.js";
import { entryOnly, heldOf, projectOnly } from "./outcomes.js";
import { MemoryProjects } from "./memory-projects.js";
import { PersonsEdits } from "./persons-edits.js";
import { UndoRecords } from "./undo-records.js";

export type FileMemoryOptions = {
  /** The memory folder, in Zhiyin's data folder. */
  readonly folder: string;
  readonly now: () => Date;
  /** Ids for writes and waiting changes, unique across starts of the app. */
  readonly newId: () => string;
  /**
   * The person's folders where work of every kind passes, never linked to a
   * project: home, Documents, Desktop, Downloads. A drive's root never is.
   */
  readonly broadFolders: readonly string[];
  /**
   * Moves a folder to the Recycle Bin. Without one, a project is never
   * deleted or merged away: it is deleted to the Recycle Bin or not at all.
   */
  readonly recycle?: ((path: string) => Promise<void>) | undefined;
};

/** How close an entry must be to be named as perhaps the same, and how many are. */
const closeEnough = 0.3;
const closestNamed = 3;
/** How many entries a call's searches give whole, and how many more they name (ADR 0026). */
const foundWhole = 5;
const foundNamed = 15;

/**
 * Memory kept as Markdown files under one folder (ADR 0026): the model's
 * tools and what starts a conversation here, the person's own changes and
 * the projects in their modules, every operation in turn.
 */
export class FileMemory implements Memory {
  readonly recallTool = recallTool;
  readonly #folder: MemoryFolder;
  readonly #options: FileMemoryOptions;
  readonly #edits: PersonsEdits;
  readonly #projects: MemoryProjects;
  readonly #records: UndoRecords;
  /** Every operation in turn, so no two writes cross and every read sees the last write. */
  readonly #queue = new Serial();
  readonly #listeners = new Set<() => void>();

  constructor(options: FileMemoryOptions) {
    this.#options = options;
    this.#folder = new MemoryFolder(options.folder, options.now);
    this.#records = new UndoRecords(this.#folder, options.now);
    this.#edits = new PersonsEdits(this.#folder, options, this.#records);
    this.#projects = new MemoryProjects(this.#folder, options);
  }

  #inTurn<Value>(work: () => Promise<Value>): Promise<Value> {
    // What can no longer be undone is let go of first; a failure to is no
    // reason to refuse what was asked.
    return this.#queue.run(async () => {
      await this.#records.letGoOfOld().catch(() => undefined);
      return work();
    });
  }

  /** A change in turn, told to the listeners once made; a refusal is no change. */
  async #writing<Value>(work: () => Promise<Value>): Promise<Value> {
    const value = await this.#inTurn(work);
    const refused =
      typeof value === "object" &&
      value !== null &&
      (value as { ok?: unknown }).ok === false;
    if (!refused) this.#tell();
    return value;
  }

  #tell(): void {
    for (const listener of this.#listeners)
      try {
        listener();
      } catch {
        // The change is made; what a listener does with it is its own.
      }
  }

  rememberToolFor(inProject: boolean) {
    return rememberToolFor(inProject);
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #now(): string {
    return this.#options.now().toISOString();
  }

  on(): Promise<boolean> {
    return this.#inTurn(async () => !(await this.#folder.read()).off);
  }

  switch(on: boolean): Promise<void> {
    return this.#writing(() => this.#folder.switch(on));
  }

  remember(input: unknown, context: WriteContext): Promise<RememberOutcome> {
    return this.#writing(async () => {
      const snapshot = await this.#folder.read();
      if (snapshot.off)
        return { ok: false, reason: "Memory is off, so nothing is kept." };
      const read = readRemember(
        input,
        (number) =>
          snapshot.entries.find((entry) => entry.number === number)?.section,
      );
      if (!read.ok) return read;
      return applyRemember(read.request, {
        folder: this.#folder,
        snapshot,
        context,
        now: this.#now(),
        newId: this.#options.newId,
      });
    });
  }

  recall(input: unknown): Promise<RecallOutcome> {
    return this.#writing(async () => {
      const asked = readRecall(input);
      if (!asked)
        return {
          answer: {
            error:
              "Give the numbers of the entries to read, or searches to find them by.",
          },
          held: {},
        };
      if (asked.searches.length > mostSearches)
        return {
          answer: { error: "Give at most five searches in one call." },
          held: {},
        };
      const snapshot = await this.#folder.read();
      const byNumber = asked.numbers.map((number) =>
        snapshot.entries.find((entry) => entry.number === number),
      );
      const notKept = asked.numbers.filter((_, index) => !byNumber[index]);
      const closeness = new Closeness(snapshot.entries);
      const found = asked.searches.map((search) => ({
        search,
        hits: closeness.found(search, foundWhole + foundNamed),
      }));
      // The closest across every search come whole, each once; the others
      // are named under the first search that found them.
      const whole: StoredEntry[] = byNumber.filter(
        (entry): entry is StoredEntry => !!entry,
      );
      const closest = found
        .flatMap(({ hits }) => hits)
        .sort((one, other) => other.score - one.score);
      let given = 0;
      for (const { entry } of closest) {
        if (given >= foundWhole) break;
        if (whole.includes(entry)) continue;
        whole.push(entry);
        given += 1;
      }
      const named = new Set<StoredEntry>();
      const alsoFound: Record<string, string[]> = {};
      for (const { search, hits } of found)
        for (const { entry } of hits) {
          if (whole.includes(entry) || named.has(entry)) continue;
          if (named.size >= foundNamed) break;
          named.add(entry);
          (alsoFound[search] ??= []).push(
            listLine(entry.number, entry.title, entry.summary),
          );
        }
      const nothing = found
        .filter(({ hits }) => !hits.length)
        .map(({ search }) => `“${search}”`);
      const now = this.#now();
      for (const entry of whole)
        await this.#folder.save(
          { ...entryOnly(entry), used: now },
          snapshot.projects,
          entry.path,
        );
      return {
        answer: {
          entries: whole.map((entry) => ({
            number: entry.number,
            title: entry.title,
            summary: entry.summary,
            scope: scopeForModel(entry.scope, snapshot),
            section: entry.section,
            written: entry.written.slice(0, 10),
            text: entry.text,
            linksTo: linkLines(entry, snapshot.entries),
            linkedFrom: linkedFrom(entry.number, snapshot.entries),
          })),
          ...(named.size ? { alsoFound } : {}),
          ...(notKept.length ? { notKept } : {}),
          ...(nothing.length
            ? { found: `Nothing kept matches ${nothing.join(" or ")}.` }
            : {}),
        },
        held: heldOf(whole),
        shown: {
          entries: whole.map(({ number, title, summary, text }) => ({
            number,
            title,
            summary,
            text,
          })),
          alsoFound: Object.values(alsoFound).flat(),
          notKept,
          nothingFor: found
            .filter(({ hits }) => !hits.length)
            .map(({ search }) => search),
        },
      };
    });
  }

  similarTo(number: number): Promise<readonly EntryLine[]> {
    return this.#inTurn(async () => {
      const { entries } = await this.#folder.read();
      const target = entries.find((entry) => entry.number === number);
      if (!target || target.section !== "knowledge") return [];
      const compared = entries.filter(
        (entry) =>
          entry.section === "knowledge" &&
          (entry.scope === target.scope || entry.scope === everythingScope),
      );
      return new Closeness(compared)
        .closestTo(target, { least: closeEnough, most: closestNamed })
        .map((entry) => ({
          number: entry.number,
          title: entry.title,
          summary: entry.summary,
        }));
    });
  }

  leastUsed(scope: string, count: number): Promise<readonly EntryLine[]> {
    return this.#inTurn(async () =>
      leastUsedLines(scope, await this.#folder.read(), count),
    );
  }

  startOf(
    project: string | undefined,
    conversation?: string,
  ): Promise<MemoryStart> {
    return this.#inTurn(async () => {
      let snapshot = await this.#folder.read();
      if (snapshot.off) return { instructions: {}, known: "", held: {} };
      const own = snapshot.projects.find((one) => one.id === project);
      // A conversation that joined a project brings what it kept for itself.
      if (
        own &&
        conversation &&
        (await carryConversation(this.#folder, snapshot, conversation, own))
      ) {
        snapshot = await this.#folder.read();
        this.#tell();
      }
      const alone =
        !own && conversation ? conversationScope(conversation) : undefined;
      const find = (scope: string, section: MemoryEntry["section"]) =>
        snapshot.entries.find(
          (entry) => entry.scope === scope && entry.section === section,
        );
      const about = find(everythingScope, "about");
      const how = find(everythingScope, "how");
      const projectHow = own && find(own.id, "how");
      const brief = own ? find(own.id, "brief") : alone && find(alone, "brief");
      const sent = [about, how, projectHow, brief].filter(
        (entry): entry is StoredEntry => !!entry,
      );
      const now = this.#now();
      for (const entry of sent)
        await this.#folder.save(
          { ...entryOnly(entry), used: now },
          snapshot.projects,
          entry.path,
        );
      const used = new Set(sent.map((entry) => entry.number));
      const entries = snapshot.entries.map((entry) =>
        used.has(entry.number) ? { ...entry, used: now } : entry,
      );
      return {
        instructions: {
          ...personsInstructions(about?.text, how?.text),
          ...(projectHow
            ? { projectHow: projectInstructions(projectHow.text) }
            : {}),
        },
        known: knownText(own, snapshot.projects, entries, alone),
        held: heldOf(sent),
      };
    });
  }

  projectFor(folder: string | undefined): Promise<MemoryProject | undefined> {
    return this.#inTurn(async () => {
      if (!folder) return undefined;
      const found = projectHolding(
        folder,
        (await this.#folder.read()).projects,
      );
      return found && projectOnly(found);
    });
  }

  projects(): Promise<readonly MemoryProject[]> {
    return this.#inTurn(async () =>
      (await this.#folder.read()).projects.map(projectOnly),
    );
  }

  async folder(): Promise<string> {
    await this.#folder.make();
    return this.#folder.root;
  }

  state(): Promise<MemoryState> {
    return this.#inTurn(async () => {
      const snapshot = await this.#folder.read();
      return {
        on: !snapshot.off,
        projects: snapshot.projects.map(projectOnly),
        entries: snapshot.entries.map(entryOnly),
        waiting: await this.#folder.ownRecords<MemoryWaiting>("waiting"),
        limits: memoryLimits,
        broadFolders: this.#options.broadFolders,
      };
    });
  }

  add(
    entry: MemoryDraft,
  ): Promise<PersonsOutcome & { readonly number?: number }> {
    return this.#writing(() => this.#edits.add(entry));
  }

  edit(number: number, edit: MemoryEdit): Promise<PersonsOutcome> {
    return this.#writing(() => this.#edits.edit(number, edit));
  }

  remove(
    number: number,
  ): Promise<PersonsOutcome & { readonly writeId?: string }> {
    return this.#writing(() => this.#edits.remove(number));
  }

  move(number: number, scope: string): Promise<PersonsOutcome> {
    return this.#writing(() => this.#edits.move(number, scope));
  }

  keep(waitingId: string): Promise<PersonsOutcome> {
    return this.#writing(() => this.#edits.keep(waitingId));
  }

  discard(waitingId: string): Promise<PersonsOutcome> {
    return this.#writing(() => this.#edits.discard(waitingId));
  }

  undo(writeId: string): Promise<PersonsOutcome> {
    return this.#writing(() => this.#edits.undo(writeId));
  }

  conversationDeleted(conversationId: string): Promise<void> {
    return this.#inTurn(() =>
      this.#records.conversationDeleted(conversationId),
    );
  }

  forgetConversation(
    conversationId: string,
    options: { readonly own: boolean; readonly general: boolean },
  ): Promise<PersonsOutcome> {
    return this.#writing(() =>
      this.#edits.forgetConversation(conversationId, options),
    );
  }

  createProject(
    name: string,
    folders: readonly string[] = [],
  ): Promise<PersonsOutcome & { readonly project?: MemoryProject }> {
    return this.#writing(() => this.#projects.create(name, folders));
  }

  renameProject(id: string, name: string): Promise<PersonsOutcome> {
    return this.#writing(() => this.#projects.rename(id, name));
  }

  linkFolder(id: string, folder: string): Promise<PersonsOutcome> {
    return this.#writing(() => this.#projects.link(id, folder));
  }

  unlinkFolder(id: string, folder: string): Promise<PersonsOutcome> {
    return this.#writing(() => this.#projects.unlink(id, folder));
  }

  archiveProject(id: string, archived: boolean): Promise<PersonsOutcome> {
    return this.#writing(() => this.#projects.archive(id, archived));
  }

  mergeProject(from: string, into: string): Promise<PersonsOutcome> {
    return this.#writing(() => this.#projects.merge(from, into));
  }

  deleteProject(id: string): Promise<PersonsOutcome> {
    return this.#writing(() => this.#projects.delete(id));
  }
}
