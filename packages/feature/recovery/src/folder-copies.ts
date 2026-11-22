/**
 * What a program that may change any file in its folder changed there,
 * against the folder as it stood when the run began (ADR 0031).
 *
 * Before the run, each file is known or watched. A file is known when the
 * store holds it as it is now, by the digest last learned of it, unless its
 * size or time differ or the drive's change journal says it was written
 * since; or when a run of this same turn left it, by that run's digest, as a
 * turn keeps a file only as it found it. Every other file is watched, and
 * saved as it is first written, so nothing is copied that the run does not
 * change. What is known of each folder is remembered, so a later turn, after
 * a restart too, watches only what is not saved as it is.
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

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type {
  CommandFileChanges,
  ListedFile,
  ListWorkspace,
} from "@zhiyin/contract";
import {
  contentReasons,
  FolderIndex,
  journalChanges,
  journalPoint,
  type JournalPoint,
} from "@zhiyin/file-watch";
import { holds, staysInside } from "@zhiyin/workspace-containment";
import type { FirstWrites, WatchOutcome } from "./first-writes.js";
import { folderKey, FolderMirrors } from "./folder-mirrors.js";
import type { PieceStore } from "./pieces/piece-store.js";
import type { CapturedFile } from "./records.js";
import {
  joinedChanges,
  runChanges,
  type Known,
  type RunCopy,
} from "./run-changes.js";
import { nextSequence, observeSequence } from "./sequence.js";
import { fileDigest, linkDigest, linkOnPath } from "./workspace-files.js";

/** Where a drive's change journal stands, and what changed since a point. */
export type ChangeJournal = {
  readonly point: typeof journalPoint;
  readonly changes: typeof journalChanges;
};

const windowsJournal: ChangeJournal = {
  point: journalPoint,
  changes: journalChanges,
};
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
  /** Files whose contents are known as they are now. */
  readonly known: ReadonlyMap<string, Known & { digest: string }>;
  /** Files to watch, or to save first, smallest first. */
  readonly wanted: readonly (readonly [string, ListedFile])[];
  /** Where the drive's change journal stood as the folder was listed. */
  readonly point?: JournalPoint;
  /** The turn the folder is in, if one is going on. */
  readonly turn?: number;
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
  readonly #pieces: PieceStore;
  readonly #writes: FirstWrites;
  readonly #journalOf: ChangeJournal;
  /** Each folder's listing, read again only where the change journal says it changed. */
  readonly #list: FolderIndex<ListedFile> | undefined;
  readonly #mirrors: FolderMirrors;
  /** The turn each folder is in, by its key, while one goes on. */
  readonly #turns = new Map<string, number>();
  readonly #journal: RunJournal;
  readonly #pending = new Map<string, Pending>();
  /**
   * Runs that ended while an earlier run in their folder went on: what they
   * recorded decides what the earlier run is credited with.
   */
  #ended: Ended[] = [];
  /** Copies written down by an earlier session, read once. */
  #left: Promise<LeftOverRuns> | undefined;
  /** Contents written by a copy still being taken, which nothing names yet. */
  readonly #fresh = new Set<string>();

  constructor(options: {
    readonly folder: string;
    /** Where copies taken for runs are written down. */
    readonly runs: string;
    readonly pieces: PieceStore;
    readonly writes: FirstWrites;
    readonly list: ListWorkspace | undefined;
    readonly now: () => Date;
    readonly journal?: ChangeJournal;
    readonly mirrors?: FolderMirrors;
  }) {
    this.#mirrors =
      options.mirrors ?? new FolderMirrors(options.folder, options.now);
    this.#journal = new RunJournal(options.runs);
    this.#pieces = options.pieces;
    this.#writes = options.writes;
    this.#journalOf = options.journal ?? windowsJournal;
    this.#list = options.list
      ? new FolderIndex(options.list, this.#journalOf)
      : undefined;
  }

  /**
   * A turn begins in the folder: a run in it from now keeps each file as the
   * turn found it, and every file not saved as it is is watched now, so the
   * first write of it waits until it is saved, whoever writes it, but in
   * the folders `without` names, kept as their own. Says which files could
   * not be watched or saved, and why.
   */
  async beginTurn(
    root: string,
    without: readonly string[] = [],
  ): Promise<FolderCopy> {
    this.#turns.set(folderKey(root), nextSequence());
    this.#writes.saving(root, true);
    const planned = await this.plan(root, without);
    if (!planned.ok) return planned;
    const { files, uncopied } = await this.#watchWanted(planned.plan);
    this.#fresh.clear();
    await this.#mirrors
      .remember(root, files, planned.plan.point)
      .catch(() => undefined);
    return {
      ok: true,
      uncopied: [...uncopied].map(([path, reason]) => ({ path, reason })),
    };
  }

  /**
   * The turn in the folder ended: a write to it is no longer saved first,
   * unless a run that began in it still goes on.
   */
  endTurn(root: string): void {
    this.#turns.delete(folderKey(root));
    if (!this.#running(root)) this.#writes.saving(root, false);
  }

  #running(root: string): boolean {
    return [...this.#pending.values()].some(
      (pending) => pending.begun && folderKey(pending.root) === folderKey(root),
    );
  }

  /**
   * Saves one file of the folder now, letting go of its watch, and
   * remembers it as saved, so it is neither watched nor held from a run.
   */
  async save(root: string, path: string): Promise<WatchOutcome> {
    const outcome = await this.#writes.save(root, path);
    if (!("saved" in outcome)) return outcome;
    const found = await lstat(join(root, path), { bigint: true }).catch(
      () => undefined,
    );
    if (!found) return outcome;
    const files = new Map<string, Known>(
      Object.entries((await this.#mirrors.filesOf(root)) ?? {}),
    );
    files.set(path, {
      size: Number(found.size),
      modified: Number(found.mtimeNs) / 1e6,
      id: String(found.ino),
      digest: outcome.saved.digest,
    });
    await this.#mirrors.remember(root, files).catch(() => undefined);
    return outcome;
  }

  /** The digest the store's latest version of a file is known by, for its deltas. */
  earlierOf(root: string, path: string): string | undefined {
    return this.#mirrors.digestOf(root, path);
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
    const point = this.#journalOf.point(root);
    const listing = await this.#list.listing(root);
    if (!listing.ok) return listing;
    const mirrored = await this.#mirrors.filesOf(root);
    const written = await this.#writtenSince(
      root,
      await this.#mirrors.pointOf(root),
      Object.values(mirrored ?? {}),
    );
    const kept = await this.#pieces.versions();
    const turn = this.#turns.get(folderKey(root));
    const known = new Map<string, Known & { digest: string }>();
    const wanted: [string, ListedFile][] = [];
    for (const [path, file] of listing.files) {
      if (!this.#own(root, without, path)) continue;
      // A link is known by what it names, and never watched, saved or followed.
      if (file.link !== undefined) {
        known.set(path, { ...file, digest: linkDigest(file.link) });
        continue;
      }
      const last = mirrored?.[path];
      const same =
        last !== undefined &&
        last.size === file.size &&
        last.modified === file.modified &&
        (last.id === undefined ||
          file.id === undefined ||
          last.id === file.id) &&
        !(written === "all" || (last.id !== undefined && written.has(last.id)));
      if (
        same &&
        (last.unstored
          ? turn !== undefined && last.turn === turn
          : kept.has(last.digest))
      )
        known.set(path, { ...last, ...(file.id ? { id: file.id } : {}) });
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
        ...(point ? { point } : {}),
        ...(turn !== undefined ? { turn } : {}),
      },
    };
  }

  /**
   * The identities of the files the change journal says were written since
   * `point`, of those named; `all` when the journal cannot say, as after it
   * was reset or wrapped, so every file is looked at again.
   */
  async #writtenSince(
    root: string,
    point: JournalPoint | undefined,
    files: readonly { readonly id?: string }[],
  ): Promise<ReadonlySet<string> | "all"> {
    const ids = new Set(files.flatMap((file) => (file.id ? [file.id] : [])));
    // A drive that keeps no journal leaves size and time to say it.
    if (!ids.size || !point) return new Set();
    const answer = this.#journalOf.changes(root, point, ids);
    if (!answer.ok) return "all";
    return new Set(
      [...answer.changed].flatMap(([id, reasons]) =>
        reasons & contentReasons ? [id] : [],
      ),
    );
  }

  /** Whether a listed file is the folder's to copy: in it, and in none it leaves out. */
  #own(root: string, without: readonly string[], path: string): boolean {
    // A listing names its files from the folder down, each in it.
    if (!without.length && !/(^|[\\/])\.\.([\\/]|$)|^[\\/]|:/.test(path))
      return true;
    const full = join(root, path);
    return (
      staysInside(root, full) && !without.some((left) => holds(left, full))
    );
  }

  /**
   * Watches each file the plan wants, or saves it now when it cannot be
   * watched, and keeps what the folder holds for the action, replacing what
   * was kept for it before. A file a run of this turn already saved and
   * something else changed since is read for its digest, not saved again.
   * `outside`: the folder is one outside the workspace the program is given.
   */
  async take(
    actionId: string,
    conversationId: string,
    plan: CopyPlan,
    begins: boolean,
    outside = false,
    room?: number,
  ): Promise<FolderCopy> {
    const id = copyId(actionId, plan.root, outside);
    // A file watched from here is saved as this run first writes it.
    if (begins) this.#writes.saving(plan.root, true);
    const { files, uncopied } = await this.#watchWanted(plan, room);
    try {
      await this.#leftOver();
      const pending: Pending = {
        actionId,
        outside,
        without: plan.without,
        root: plan.root,
        seq: nextSequence(),
        conversationId,
        files,
        uncopied,
        begun: begins || (this.#pending.get(id)?.begun ?? false),
        ...(plan.point ? { point: plan.point } : {}),
      };
      // On disk before the run can start, so a crash cannot lose it.
      await this.#journal.write(id, pending);
      this.#pending.set(id, pending);
    } finally {
      this.#fresh.clear();
    }
    // Unremembered, each file is only watched again next time.
    await this.#mirrors
      .remember(plan.root, files, plan.point)
      .catch(() => undefined);
    return {
      ok: true,
      uncopied: [...uncopied].map(([path, reason]) => ({ path, reason })),
    };
  }

  /**
   * The folder's files as known before a run: each known one with its
   * digest, each wanted one watched or saved now, and why any could not be.
   */
  async #watchWanted(
    plan: CopyPlan,
    room?: number,
  ): Promise<{
    readonly files: Map<string, Known>;
    readonly uncopied: Map<string, string>;
  }> {
    const files = new Map<string, Known>(plan.known);
    const uncopied = new Map<string, string>();
    const toWatch: [string, number][] = [];
    for (const [path, listed] of plan.wanted) {
      // Saved in this turn already: the turn keeps it as it found it, which
      // going back to the turn's message puts back, and the run needs only
      // to know what it holds now.
      const saved =
        plan.turn !== undefined
          ? this.#writes.savedSince(plan.root, path, plan.turn)
          : undefined;
      if (saved) {
        const digest = await fileDigest(plan.root, join(plan.root, path)).catch(
          () => undefined,
        );
        if (digest) {
          files.set(path, {
            ...listed,
            digest,
            unstored: true,
            turn: plan.turn!,
            turnStart: { digest: saved.digest, bytes: saved.bytes },
          });
          continue;
        }
      }
      toWatch.push([path, listed.size]);
    }
    const outcomes = await this.#writes.watch(plan.root, toWatch, room);
    for (const [path] of toWatch) {
      const listed = plan.listed.get(path)!;
      const outcome = outcomes.get(path);
      if (!outcome || "failed" in outcome) {
        uncopied.set(
          path,
          outcome?.failed ?? "It could not be watched or saved before the run.",
        );
        files.set(path, listed);
      } else if ("saved" in outcome) {
        this.#fresh.add(outcome.saved.digest);
        files.set(path, { ...listed, digest: outcome.saved.digest });
      } else files.set(path, { ...listed, watched: true });
    }
    return { files, uncopied };
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

  /**
   * The earliest a save may still be weighed from: the oldest run still to
   * be recorded, or the oldest turn going on. A save before it is either in
   * an action's record by now, or of no action's.
   */
  async oldestNeeded(): Promise<number> {
    // A run an earlier session never recorded is weighed from its saves too.
    await this.#leftOver();
    return Math.min(
      ...[...this.#pending.values()].map((pending) => pending.seq),
      ...this.#turns.values(),
    );
  }

  /** Contents a copy waiting for its run, or being taken, needs. */
  inUse(): { has(digest: string): boolean } {
    const fresh = new Set(this.#fresh);
    const waiting = [...this.#pending.values()].map((pending) => {
      const known = this.#needs.get(pending);
      if (known) return known;
      const digests = new Set<string>();
      for (const file of pending.files.values()) {
        if (file.digest) digests.add(file.digest);
        if (file.turnStart) digests.add(file.turnStart.digest);
      }
      this.#needs.set(pending, digests);
      return digests;
    });
    return {
      has: (digest) =>
        fresh.has(digest) || waiting.some((needs) => needs.has(digest)),
    };
  }

  /** The contents each copy waiting for its run needs, worked out once. */
  readonly #needs = new WeakMap<Pending, ReadonlySet<string>>();

  /** The folders whose copies are remembered, those of a waiting run marked. */
  async mirrors(): Promise<
    {
      readonly key: string;
      readonly root: string;
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
    const listing = await (this.#list?.listing(root) ??
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
        // Looked at by itself, never through a link.
        if (await linkOnPath(root, join(root, path))) continue;
        const found = await lstat(join(root, path)).catch(() => undefined);
        if (found?.isFile())
          current.set(path, { size: found.size, modified: found.mtimeMs });
      }
    // Only a run that began, or ended, can have changed a file: a copy
    // taken before approval is taken again as its run begins.
    const later = [
      ...[...this.#pending.values()].filter((copy) => copy.begun),
      ...this.#ended,
    ].filter((copy) => copy.root === root && copy.seq > pending.seq);
    // What each watched file held is what was saved as it was first written;
    // one never saved was never written, unless something kept it from
    // being saved, which is then the reason it cannot be put back.
    await this.#writes.settled();
    const uncopied = new Map(pending.uncopied);
    const before = new Map<string, Known>();
    for (const [path, file] of pending.files) {
      if (!file.watched) {
        before.set(path, file);
        continue;
      }
      const saved = this.#writes.savedSince(root, path, pending.seq);
      const { watched, ...listed } = file;
      void watched;
      before.set(path, saved ? { ...listed, digest: saved.digest } : listed);
      if (!saved)
        uncopied.set(
          path,
          this.#writes.unsavedSince(root, path, pending.seq) ??
            "It changed without being saved first.",
        );
    }
    const point = this.#journalOf.point(root);
    const ids = [...pending.files.values()].flatMap((file) =>
      file.id ? [{ id: file.id }] : [],
    );
    const writtenIds = await this.#writtenSince(root, pending.point, ids);
    const written = new Set(
      [...pending.files].flatMap(([path, file]) =>
        writtenIds === "all" || (file.id && writtenIds.has(file.id))
          ? [path]
          : [],
      ),
    );
    const found = await runChanges({
      run: { ...pending, files: before },
      uncopied,
      current,
      later,
      written,
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
    await this.#learn(root, before, current, found.files, point);
    if (this.#turns.get(folderKey(root)) === undefined && !this.#running(root))
      this.#writes.saving(root, false);
    return { root, outside, conversationId, ...found };
  }

  /**
   * Remembers what the run left: each file it changed by the digest it
   * left, unstored, in the turn going on; each it deleted forgotten.
   */
  async #learn(
    root: string,
    before: ReadonlyMap<string, Known>,
    current: ReadonlyMap<string, ListedFile>,
    changed: readonly CapturedFile[],
    point: JournalPoint | undefined,
  ): Promise<void> {
    const turn = this.#turns.get(folderKey(root));
    const known = new Map<string, Known>();
    const mirrored = (await this.#mirrors.filesOf(root)) ?? {};
    for (const [path, file] of Object.entries(mirrored)) known.set(path, file);
    for (const [path, file] of before) if (file.digest) known.set(path, file);
    for (const file of changed) {
      const now = current.get(file.path);
      if (file.after === "file" && file.afterDigest && now)
        known.set(file.path, {
          ...now,
          digest: file.afterDigest,
          unstored: true,
          ...(turn !== undefined ? { turn } : {}),
        });
      else known.delete(file.path);
    }
    await this.#mirrors.remember(root, known, point).catch(() => undefined);
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
      observeSequence(run.seq);
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
          ...(run.point ? { point: run.point } : {}),
        });
      }
    }
    await this.#prune();
    return { cut, unbegun };
  }
}
