/**
 * A copy of a whole folder, taken before a program that may change any of its
 * files runs in it, and what the program changed, found against that copy.
 *
 * The copy is kept up to date between runs: each run copies only the files
 * whose size or time of last change differs from the last copy, and contents
 * kept already are not kept again. What was copied is remembered for each
 * folder, so a later run, after a restart too, copies only what changed
 * since.
 *
 * The copy taken for a run is written down before the run starts, so a run
 * that Zhiyin stopped with, by a crash or by quitting while a job went on, is
 * still recorded against it at the next start; one whose run never began is
 * let go of then. A run that ends while an earlier one in its folder goes on
 * stays written down, as what it recorded, until no such run needs it.
 *
 * An action may have several copies: its workspace's, and one of each folder
 * outside it that its program is given. Each is taken, written down and
 * weighed on its own; the action is taken to have begun once any of them was
 * taken as its run began.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  CommandFileChanges,
  ListedFile,
  ListWorkspace,
} from "@zhiyin/contract";
import { holds, staysInside } from "@zhiyin/workspace-containment";
import type { ContentStore } from "./content-store.js";
import { folderKey, FolderMirrors } from "./folder-mirrors.js";
import type { CapturedFile } from "./records.js";
import {
  joinedChanges,
  runChanges,
  sizeOf,
  type Known,
  type RunCopy,
} from "./run-changes.js";
import {
  copyId,
  idOf,
  RunJournal,
  type Ended,
  type Pending,
} from "./run-journal.js";

/** What one copy of an action found its program changed. */
type CopyChanges = {
  readonly root: string;
  readonly outside: boolean;
  readonly conversationId: string;
  readonly files: readonly CapturedFile[];
  readonly shown: CommandFileChanges;
};

/** The copies an earlier session wrote down for runs it never recorded. */
export type LeftOverRuns = {
  /** Runs it began, oldest first: Zhiyin stopped while they went on. */
  readonly cut: readonly string[];
  /** Runs that never began; their copies are let go of. */
  readonly unbegun: readonly string[];
};

/** What copying a folder needs, worked out before room is made for it. */
export type CopyPlan = {
  readonly root: string;
  /** Folders inside it left to copies of their own. */
  readonly without: readonly string[];
  readonly listed: ReadonlyMap<string, ListedFile>;
  /** Files whose last copy is still what they hold. */
  readonly known: ReadonlyMap<string, Known & { digest: string }>;
  /** Files to copy, smallest first. */
  readonly wanted: readonly (readonly [string, ListedFile])[];
  /** Files too large to copy at all. */
  readonly tooLarge: readonly string[];
  /** The most the wanted files can take. */
  readonly needed: number;
};

/** What copying a folder before a run found. */
export type FolderCopy =
  | {
      readonly ok: true;
      /** The files that could not be copied, with why. */
      readonly uncopied: readonly {
        readonly path: string;
        readonly reason: string;
      }[];
    }
  | { readonly ok: false; readonly reason: string };

export class FolderCopies {
  readonly #store: ContentStore;
  readonly #list: ListWorkspace | undefined;
  readonly #fileBytes: number;
  readonly #mirrors: FolderMirrors;
  readonly #journal: RunJournal;
  readonly #pending = new Map<string, Pending>();
  /**
   * Runs that ended while an earlier run in their folder went on: what they
   * recorded decides what the earlier run is credited with.
   */
  #ended: Ended[] = [];
  /** Copies written down by an earlier session, read once. */
  #left: Promise<LeftOverRuns> | undefined;
  /** The order copies are taken in, across sessions too. */
  #sequence = 0;
  /** Contents written by a copy still being taken, which nothing names yet. */
  readonly #fresh = new Set<string>();

  constructor(options: {
    readonly folder: string;
    /** Where copies taken for runs are written down. */
    readonly runs: string;
    readonly store: ContentStore;
    readonly list: ListWorkspace | undefined;
    readonly fileBytes: number;
    readonly now: () => Date;
  }) {
    this.#mirrors = new FolderMirrors(options.folder, options.now);
    this.#journal = new RunJournal(options.runs);
    this.#store = options.store;
    this.#list = options.list;
    this.#fileBytes = options.fileBytes;
  }

  /**
   * The folder's files, but those in the folders `without` names, and which
   * of them need copying.
   */
  async plan(
    root: string,
    without: readonly string[] = [],
  ): Promise<
    | { readonly ok: true; readonly plan: CopyPlan }
    | {
        readonly ok: false;
        readonly reason: string;
      }
  > {
    if (!this.#list)
      return { ok: false, reason: "Zhiyin cannot list this folder's files." };
    const listing = await this.#list(root);
    if (!listing.ok) return listing;
    const mirrored = await this.#mirrors.filesOf(root);
    const kept = await this.#store.sizes();
    const known = new Map<string, Known & { digest: string }>();
    const wanted: [string, ListedFile][] = [];
    const tooLarge: string[] = [];
    for (const [path, file] of listing.files) {
      if (!this.#own(root, without, path)) continue;
      const last = mirrored?.[path];
      if (
        last &&
        last.size === file.size &&
        last.modified === file.modified &&
        kept.has(last.digest)
      )
        known.set(path, last);
      else if (file.size > this.#fileBytes) tooLarge.push(path);
      else wanted.push([path, file]);
    }
    wanted.sort(([, a], [, b]) => a.size - b.size);
    return {
      ok: true,
      plan: {
        root,
        without,
        listed: listing.files,
        known,
        wanted,
        tooLarge,
        needed: wanted.reduce((sum, [, file]) => sum + file.size, 0),
      },
    };
  }

  /** Whether a listed file is the folder's to copy: in it, and in none it leaves out. */
  #own(root: string, without: readonly string[], path: string): boolean {
    const full = join(root, path);
    return (
      staysInside(root, full) && !without.some((left) => holds(left, full))
    );
  }

  /**
   * Copies what the plan wants within `room` bytes, smallest first, and
   * keeps the copy for the action, replacing one taken for it before.
   * `outside`: the folder is one outside the workspace the program is given.
   */
  async take(
    actionId: string,
    conversationId: string,
    plan: CopyPlan,
    room: number,
    begins: boolean,
    outside = false,
  ): Promise<FolderCopy> {
    const id = copyId(actionId, plan.root, outside);
    const files = new Map<string, Known>(plan.known);
    const uncopied = new Map<string, string>();
    const limit = sizeOf(this.#fileBytes);
    for (const path of plan.tooLarge)
      uncopied.set(
        path,
        `It is larger than the ${limit} recovery limit, so no copy was taken before the run.`,
      );
    const kept = await this.#store.sizes();
    let left = room;
    try {
      for (const [path, listed] of plan.wanted) {
        const full = `The recovery storage limit could not admit it, so no copy was taken before the run.`;
        // Past the room left, a file is not read at all: in a folder far
        // larger than the total, reading every file each run would cost more
        // than any copy saves.
        if (listed.size > left) {
          uncopied.set(path, full);
          files.set(path, listed);
          continue;
        }
        const staged = await this.#store
          .stage(join(plan.root, path))
          .catch(() => undefined);
        // Gone since it was listed: nothing of it to copy.
        if (!staged) continue;
        const { digest, bytes } = staged;
        const tooLarge = bytes > this.#fileBytes;
        if (tooLarge || (!kept.has(digest) && bytes > left)) {
          await this.#store.drop(staged);
          uncopied.set(
            path,
            tooLarge
              ? `It is larger than the ${limit} recovery limit, so no copy was taken before the run.`
              : full,
          );
          files.set(path, listed);
          continue;
        }
        if (!kept.has(digest)) {
          this.#fresh.add(digest);
          left -= bytes;
        }
        await this.#store.keep(staged);
        files.set(path, { ...listed, digest });
      }
      for (const path of plan.tooLarge) {
        const listed = plan.listed.get(path);
        if (listed) files.set(path, listed);
      }
      await this.#leftOver();
      const pending: Pending = {
        actionId,
        outside,
        without: plan.without,
        root: plan.root,
        seq: this.#next(),
        conversationId,
        files,
        uncopied,
        begun: begins || (this.#pending.get(id)?.begun ?? false),
      };
      // On disk before the run can start, so a crash cannot lose it.
      await this.#journal.write(id, pending);
      this.#pending.set(id, pending);
    } finally {
      this.#fresh.clear();
    }
    // Unremembered, the folder is only copied whole again next time.
    await this.#mirrors.remember(plan.root, files).catch(() => undefined);
    return {
      ok: true,
      uncopied: [...uncopied].map(([path, reason]) => ({ path, reason })),
    };
  }

  /**
   * Keeps these contents from going until the copy being taken is kept for
   * its action, as the files it found already copied need.
   */
  reserve(digests: Iterable<string>): void {
    for (const digest of digests) this.#fresh.add(digest);
  }

  /** Whether a copy is waiting for this action's run to end. */
  has(actionId: string): boolean {
    return this.#idsOf(actionId).length > 0;
  }

  /** Lets go of every copy taken for an action that will not run. */
  async forget(actionId: string): Promise<void> {
    await this.#leftOver();
    for (const id of this.#idsOf(actionId)) {
      this.#pending.delete(id);
      await this.#journal.remove(id);
    }
    await this.#prune();
  }

  /** The copies waiting for this action's run, the workspace's first. */
  #idsOf(actionId: string): string[] {
    return [...this.#pending]
      .filter(([, pending]) => pending.actionId === actionId)
      .sort(([, a], [, b]) => Number(a.outside) - Number(b.outside))
      .map(([id]) => id);
  }

  async forgetConversation(conversationId: string): Promise<void> {
    await this.#leftOver();
    for (const [, pending] of [...this.#pending])
      if (pending.conversationId === conversationId)
        await this.forget(pending.actionId);
  }

  /**
   * The actions whose copies an earlier session wrote down and never
   * recorded against: those whose runs were cut short, oldest first, and
   * those whose runs never began, whose copies are let go of.
   */
  leftOver(): Promise<LeftOverRuns> {
    return this.#leftOver();
  }

  /** Contents a copy waiting for its run, or being taken, needs. */
  inUse(): Set<string> {
    const digests = new Set(this.#fresh);
    for (const pending of this.#pending.values())
      for (const file of pending.files.values())
        if (file.digest) digests.add(file.digest);
    return digests;
  }

  /** The folders whose copies are remembered, those of a waiting run marked. */
  async mirrors(): Promise<
    {
      readonly key: string;
      readonly usedAt: number;
      readonly digests: ReadonlySet<string>;
      readonly waiting: boolean;
    }[]
  > {
    const waiting = new Set(
      [...this.#pending.values()].map((pending) => folderKey(pending.root)),
    );
    return (await this.#mirrors.list()).map((mirror) => ({
      ...mirror,
      waiting: waiting.has(mirror.key),
    }));
  }

  /** Forgets what was copied of a folder, so it is copied again. */
  dropMirror(key: string): Promise<void> {
    return this.#mirrors.drop(key);
  }

  /**
   * What the action's program changed in its folders, against the copies
   * taken before it ran: each file it created, changed or deleted, as the
   * store records it, and as an action shows it, a file outside the
   * workspace by its whole path. Nothing when no copy was taken.
   * When the folder cannot be listed, each file the copy holds is still
   * looked at by itself, and what the run made is said to be unknown.
   */
  async changes(actionId: string): Promise<
    | {
        readonly root: string;
        readonly conversationId: string;
        readonly files: readonly CapturedFile[];
        readonly shown: CommandFileChanges;
      }
    | undefined
  > {
    await this.#leftOver();
    const copies: CopyChanges[] = [];
    for (const id of this.#idsOf(actionId))
      copies.push(await this.#changes(id));
    const [first] = copies;
    if (!first) return undefined;
    // One record, kept in the workspace the action ran in; its copy is taken
    // first. Without it, the record is of a folder the conversation is not
    // in, and going back holds its changes as made elsewhere.
    const workspace = copies.find((copy) => !copy.outside) ?? first;
    return {
      root: workspace.root,
      conversationId: workspace.conversationId,
      ...joinedChanges(copies),
    };
  }

  /** What one copy's program changed in its folder; see `changes`. */
  async #changes(id: string): Promise<CopyChanges> {
    const pending = this.#pending.get(id)!;
    const { root, conversationId, actionId, outside } = pending;
    const listing = await (this.#list?.(root) ??
      Promise.resolve({
        ok: false as const,
        reason: "Zhiyin cannot list this folder's files.",
      }));
    const current = new Map<string, ListedFile>();
    if (listing.ok) {
      for (const [path, file] of listing.files)
        if (this.#own(root, pending.without, path)) current.set(path, file);
    } else
      for (const path of pending.files.keys()) {
        const found = await stat(join(root, path)).catch(() => undefined);
        if (found?.isFile())
          current.set(path, { size: found.size, modified: found.mtimeMs });
      }
    // Only a run that began, or ended, can have changed a file: a copy
    // taken before approval is taken again as its run begins.
    const later = [
      ...[...this.#pending.values()].filter((copy) => copy.begun),
      ...this.#ended,
    ].filter((copy) => copy.root === root && copy.seq > pending.seq);
    const found = await runChanges({
      run: pending,
      uncopied: pending.uncopied,
      current,
      later,
      fileBytes: this.#fileBytes,
      ...(listing.ok
        ? {}
        : {
            unlisted: `The folder could not be listed after the run (${listing.reason}), so the files it made are not named; each file there before was looked at by itself.`,
          }),
    });
    this.#pending.delete(id);
    // Kept while an earlier run in the folder goes on, for its credit, on
    // disk in place of its copy, so a restart keeps it too.
    const recorded = found.files.map((file) => file.path);
    const ended: Ended = {
      actionId,
      outside,
      root,
      seq: pending.seq,
      files: new Map(
        recorded.flatMap((path) => {
          const file = pending.files.get(path);
          return file ? [[path, file] as const] : [];
        }),
      ),
      recorded: new Set(recorded),
    };
    if (this.#needed(ended)) {
      await this.#journal.writeEnded(ended);
      this.#ended.push(ended);
    } else await this.#journal.remove(id);
    await this.#prune();
    return { root, outside, conversationId, ...found };
  }

  /**
   * Whether a run that ended is still needed: an earlier one goes on. One
   * awaiting approval is copied again as it begins, after this one.
   */
  #needed(ended: RunCopy): boolean {
    return [...this.#pending.values()].some(
      (open) => open.begun && open.root === ended.root && open.seq < ended.seq,
    );
  }

  /** Lets go of the ended runs no run still going needs. */
  async #prune(): Promise<void> {
    const gone = this.#ended.filter((ended) => !this.#needed(ended));
    this.#ended = this.#ended.filter((ended) => this.#needed(ended));
    for (const ended of gone)
      await this.#journal.remove(
        copyId(ended.actionId, ended.root, ended.outside),
      );
  }

  #next(): number {
    this.#sequence = Math.max(this.#sequence + 1, Date.now() * 1000);
    return this.#sequence;
  }

  /** Reads the copies an earlier session wrote down, once. */
  #leftOver(): Promise<LeftOverRuns> {
    if (!this.#left) {
      this.#left = this.#readRuns();
      this.#left.catch(() => (this.#left = undefined));
    }
    return this.#left;
  }

  async #readRuns(): Promise<LeftOverRuns> {
    const found = await this.#journal.read();
    // An action began once any of its copies was taken as its run began; a
    // copy of it taken only before approval is not what the run started
    // from, and goes.
    const began = new Set(
      found.flatMap((run) =>
        !("ended" in run) && run.begun ? [run.actionId] : [],
      ),
    );
    const cut: string[] = [];
    const unbegun: string[] = [];
    for (const run of found) {
      this.#sequence = Math.max(this.#sequence, run.seq);
      const id = idOf(run);
      if ("ended" in run)
        this.#ended.push({
          actionId: run.actionId,
          outside: run.outside === true,
          root: run.root,
          seq: run.seq,
          files: new Map(run.files),
          recorded: new Set(run.recorded),
        });
      else if (!run.begun) {
        if (!began.has(run.actionId) && !unbegun.includes(run.actionId))
          unbegun.push(run.actionId);
        await this.#journal.remove(id);
      } else if (!this.#pending.has(id)) {
        if (!cut.includes(run.actionId)) cut.push(run.actionId);
        this.#pending.set(id, {
          actionId: run.actionId,
          outside: run.outside === true,
          without: run.without ?? [],
          root: run.root,
          seq: run.seq,
          conversationId: run.conversationId,
          files: new Map(run.files),
          uncopied: new Map(run.uncopied),
          begun: true,
        });
      }
    }
    await this.#prune();
    return { cut, unbegun };
  }
}
