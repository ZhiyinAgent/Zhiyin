/**
 * File recovery as one store (ADR 0013, ADR 0031): capturing a declared
 * change, keeping each file a program may change as its turn found it,
 * reviewing and restoring, and the undo budget, over the records of each
 * kept action and one store of shared pieces.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { WatchThread, WatchThreadData } from "@zhiyin/file-watch";
import { replaceFile } from "@zhiyin/files";
import { Serial } from "@zhiyin/one-at-a-time";
import { holds } from "@zhiyin/workspace-containment";
import type {
  CommandFileChange,
  CommandFileChanges,
  FileChange,
  ListWorkspace,
  RewindCommitResult,
  TaskAction,
  UndoBudgetState,
} from "@zhiyin/contract";
import {
  captureFiles,
  commandFiles,
  leftBehind,
  stillAsCaptured,
} from "./capture.js";
import {
  FirstWrites,
  type RoomChoice,
  type RoomQuestion,
} from "./first-writes.js";
import {
  FolderCopies,
  type ChangeJournal,
  type FolderCopy,
} from "./folder-copies.js";
import { ManifestStore, runManifest } from "./manifest-store.js";
import { PieceStore } from "./pieces/piece-store.js";
import type { Manifest } from "./records.js";
import {
  restoreReview,
  type Materialize,
  type RestoreCalls,
} from "./restore.js";
import {
  reviewActions,
  versionsIn,
  type FileVersions,
  type RecoveryReview,
} from "./review.js";
import {
  applyLimits,
  defaultBudget,
  type RecoveryLimits,
  type ReleasedVersion,
} from "./storage-limits.js";
import { safeAbsolute } from "./workspace-files.js";

export type { RecoveryLimits, ReleasedVersion } from "./storage-limits.js";
export type { FolderCopy } from "./folder-copies.js";
export type { FileVersions, RecoveryReview } from "./review.js";
export type { RoomChoice, RoomQuestion } from "./first-writes.js";
export { mostWatched } from "./first-writes.js";

const mib = 1024 * 1024;

/** The free space on the disk holding `folder`, or nothing when it cannot be read. */
async function freeSpace(folder: string): Promise<number | undefined> {
  await mkdir(folder, { recursive: true });
  const disk = await statfs(folder).catch(() => undefined);
  return disk ? disk.bavail * disk.bsize : undefined;
}

export type RecoveryPreparation = {
  readonly actionId: string;
  readonly files: readonly {
    readonly path: string;
    readonly status: "protected" | "unprotected";
    readonly reason?: string;
    /** A file the undo budget could not hold, so a change to it cannot be undone. */
    readonly tooLarge?: true;
  }[];
};

/** How much room the undo budget allows, and how much of it is used. */
export type UndoBudget = UndoBudgetState;

/** What a turn's start found in its folders: the files that could not be watched or saved. */
export type TurnStart = {
  readonly folders: readonly {
    readonly root: string;
    readonly copy: FolderCopy;
  }[];
};

export interface Recovery {
  prepare(
    actionId: string,
    workspaceRoot: string,
    changes: readonly FileChange[],
    conversationId: string,
  ): Promise<RecoveryPreparation>;
  validate(
    actionId: string,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: string }
  >;
  commit(actionId: string): Promise<void>;
  /**
   * Records the files a shell command created or changed, as it left them.
   * No copy is taken: a file the command created did not exist before, and
   * one it changed can be removed only when an earlier action created it.
   */
  keepCommandChanges(
    actionId: string,
    workspaceRoot: string,
    changes: readonly CommandFileChange[],
    conversationId: string,
  ): Promise<void>;
  /**
   * Readies a folder for an action whose program may change any file in it:
   * lists it, and watches each file the store does not hold as it is now,
   * so the run's first write of it waits until it is saved (ADR 0031).
   * Asked again for the same action, as just before it runs, it readies only
   * what changed since. Says which files could not be watched or saved, or
   * why the folder could not be readied. `begins` marks what was readied as
   * the run begins: what was readied for a run that never began is let go of
   * at the next start.
   *
   * `outside` readies a folder outside the workspace the program is given,
   * beside the workspace, leaving out the folders `without` names, as the
   * workspace is when the folder holds it. Its changes are recorded by their
   * whole paths.
   */
  copyFolder(
    actionId: string,
    workspaceRoot: string,
    conversationId: string,
    options?: {
      readonly begins?: boolean;
      readonly outside?: boolean;
      readonly without?: readonly string[];
    },
  ): Promise<FolderCopy>;
  /**
   * Records every file the action's program created, changed or deleted in
   * its folders, against each file as the run found it, so going back puts
   * each back as a declared change is: in the workspace by its path there,
   * elsewhere by its whole path. Answers what changed, or nothing when no
   * folder was readied for the action.
   */
  keepFolderChanges(actionId: string): Promise<CommandFileChanges | undefined>;
  discard(actionId: string): Promise<void>;
  review(
    reviewId: string,
    workspaceRoot: string,
    actions: readonly TaskAction[],
  ): Promise<RecoveryReview>;
  restore(review: RecoveryReview): Promise<RewindCommitResult>;
  /**
   * The file before the first of these actions and as the last left it, or
   * why that cannot be shown: no copy was kept, or the file changed since.
   */
  versions(
    workspaceRoot: string,
    actions: readonly TaskAction[],
    path: string,
  ): Promise<FileVersions>;
  cleanup(): Promise<void>;
  /** Removes everything kept for a deleted conversation's actions. */
  forgetConversation(conversationId: string): Promise<void>;
  /**
   * A turn of the conversation begins in these folders, its workspace first,
   * then each folder outside it the conversation may change: from now until
   * it ends, every file in them is kept as the turn found it, saved as it is
   * first written, whoever writes it. A folder inside another given is kept
   * with it; one holding the workspace keeps all but the workspace, which is
   * kept as itself. A folder not there is left out. Begun again while it goes
   * on, each file is kept as it is from then.
   */
  beginTurn(
    conversationId: string,
    folders: readonly string[],
  ): Promise<TurnStart>;
  /** The conversation's turn ended: a write in its folders is no longer saved first. */
  endTurn(conversationId: string): Promise<void>;
  /**
   * Saves one file of the folder now, as `prepare_change` asks, so a run may
   * change it though it could not be watched. Says why when it cannot be.
   */
  prepareChange(
    workspaceRoot: string,
    path: string,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: string }
  >;
  /** Lets go at once of what was kept for actions a rewind removed. */
  forgetActions(actionIds: readonly string[]): Promise<void>;
  /** The undo budget and how much of it is used. */
  undoBudget(): Promise<UndoBudget>;
  /** Sets the undo budget, letting go of versions in order to fit it. */
  setUndoBudget(bytes: number): Promise<UndoBudget>;
}

/**
 * The backups around one declared file change, as the agent loop takes them:
 * a copy before it is decided, checked before it runs, completed once it ran
 * or thrown away when it did not, and what a command changed.
 */
export type FileBackups = Pick<
  Recovery,
  "prepare" | "validate" | "commit" | "discard" | "keepCommandChanges"
>;

/** The turns a conversation's files are kept by, as the agent loop marks them. */
export type TurnFiles = Pick<
  Recovery,
  "beginTurn" | "endTurn" | "prepareChange"
>;

export class FileRecovery implements Recovery {
  readonly #root: string;
  /**
   * What every action shares: the store of pieces, the copies a watch made
   * that wait to go into it, what was saved and when, and the budget.
   */
  get #content(): string {
    return join(this.#root, "content");
  }
  readonly #given: Partial<RecoveryLimits>;
  readonly #freeBytes: () => Promise<number | undefined>;
  #budget: Promise<{ bytes: number; chosen: boolean }> | undefined;
  /** Whether the budget is kept on disk, or needs no keeping. */
  #budgetKept = false;
  readonly #now: () => Date;
  readonly #beforeManifest: (() => Promise<void>) | undefined;
  readonly #released:
    ((versions: readonly ReleasedVersion[]) => void) | undefined;
  readonly #restoreCalls: RestoreCalls | undefined;
  readonly #pieces: PieceStore;
  readonly #writes: FirstWrites;
  readonly #copies: FolderCopies;
  readonly #manifests: ManifestStore;
  /** Folders are readied one at a time. */
  readonly #copying = new Serial();
  readonly #prepared = new Map<string, Manifest>();
  /** Folders whose copies are being taken, before they have a manifest. */
  readonly #preparing = new Set<string>();
  /** The contents each capture under way kept so far. */
  readonly #capturing = new Set<Set<string>>();
  /** The folders each conversation's turn is going on in. */
  readonly #turns = new Map<string, readonly string[]>();

  constructor(
    dataDirectory: string,
    options: {
      readonly limits?: Partial<RecoveryLimits>;
      readonly now?: () => Date;
      /**
       * Tests only: waited for once an action's copies are written and before
       * its manifest is, so a test can act in between. It cannot leave the
       * manifest out.
       */
      readonly beforeManifest?: () => Promise<void>;
      /**
       * How a folder's files are listed, to ready it before a program runs
       * in it; absent, no folder is readied.
       */
      readonly list?: ListWorkspace;
      /** The free space on recovery's disk; read from the disk by default. */
      readonly freeBytes?: () => Promise<number | undefined>;
      /**
       * Starts the thread that watches files, so each is saved as it is first
       * written; absent, a file is saved before each run instead.
       */
      readonly watch?: (data: WatchThreadData) => WatchThread;
      /** Where the drive's change journal stands; Windows' own by default. */
      readonly journal?: ChangeJournal;
      /**
       * Asks the person about a write whose file does not fit in the undo
       * budget, in the conversation whose turn is going on in its folder.
       */
      readonly ask?: (
        question: RoomQuestion & {
          readonly conversationId?: string;
          /** What is left of the budget, and the whole of it. */
          readonly roomBytes: number;
          readonly budgetBytes: number;
        },
      ) => Promise<RoomChoice>;
      /** Hears each version let go of, to say so in its conversation. */
      readonly released?: (versions: readonly ReleasedVersion[]) => void;
      /**
       * Tests only: wraps the Windows calls a restore makes, so a test can
       * act between them as another program may.
       */
      readonly restoreCalls?: RestoreCalls;
    } = {},
  ) {
    this.#root = join(dataDirectory, "recovery");
    this.#given = options.limits ?? {};
    this.#freeBytes = options.freeBytes ?? (() => freeSpace(this.#root));
    this.#now = options.now ?? (() => new Date());
    this.#beforeManifest = options.beforeManifest;
    this.#released = options.released;
    this.#restoreCalls = options.restoreCalls;
    this.#pieces = new PieceStore(this.#content);
    const ask = options.ask;
    this.#writes = new FirstWrites({
      folder: this.#content,
      pieces: this.#pieces,
      ...(options.watch ? { start: options.watch } : {}),
      earlier: (root, path) => this.#copies.earlierOf(root, path),
      ...(ask
        ? {
            ask: async (question: RoomQuestion) => {
              const budget = (await this.#budgetNow()).bytes;
              const used = await this.#used();
              return ask({
                ...question,
                ...this.#whoseTurn(question.root),
                roomBytes: Math.max(0, budget - used),
                budgetBytes: budget,
              });
            },
          }
        : {}),
      makeRoom: async (bytes, originals) =>
        (
          await this.#clean(undefined, {
            reserve: bytes,
            ...(originals ? { originals } : {}),
          })
        ).left >= bytes,
    });
    this.#copies = new FolderCopies({
      folder: join(this.#root, "folders"),
      runs: join(this.#root, "runs"),
      pieces: this.#pieces,
      writes: this.#writes,
      list: options.list,
      now: this.#now,
      ...(options.journal ? { journal: options.journal } : {}),
    });
    this.#manifests = new ManifestStore({
      root: this.#root,
      copies: this.#copies,
      now: this.#now,
      inUse: (folder) => this.#inUse(folder),
    });
  }

  async prepare(
    actionId: string,
    workspaceRoot: string,
    changes: readonly FileChange[],
    conversationId: string,
  ): Promise<RecoveryPreparation> {
    await this.cleanup();
    const folder = this.#manifests.folderOf(actionId);
    this.#preparing.add(folder);
    try {
      return await this.#capture(
        actionId,
        conversationId,
        workspaceRoot,
        changes,
        folder,
      );
    } catch (error) {
      // Copies a capture took before it failed are named by no record, and
      // go out of the store's files at once.
      if (!this.#prepared.has(actionId)) {
        await rm(folder, { recursive: true, force: true }).catch(
          () => undefined,
        );
        this.#preparing.delete(folder);
        await this.#clean(undefined, { purge: true }).catch(() => undefined);
      }
      throw error;
    } finally {
      this.#preparing.delete(folder);
    }
  }

  async #capture(
    actionId: string,
    conversationId: string,
    workspaceRoot: string,
    changes: readonly FileChange[],
    folder: string,
  ): Promise<RecoveryPreparation> {
    const root = await realpath(workspaceRoot).catch(() => undefined);
    if (root === undefined)
      return {
        actionId,
        files: changes.map((change) => ({
          path: change.path,
          status: "unprotected" as const,
          reason:
            "The conversation's folder could not be opened, so no copy was taken.",
        })),
      };
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    // What the change will write is saved by Zhiyin, never waited on.
    const absolutes: string[] = [];
    let wanted = 0;
    for (const change of changes) {
      const absolute = await safeAbsolute(root, change.path).catch(
        () => undefined,
      );
      if (!absolute) continue;
      absolutes.push(absolute);
      wanted += (await stat(absolute).catch(() => undefined))?.size ?? 0;
    }
    await this.#writes.settle(absolutes);
    // Older versions make room in the budget's order; the copies of actions
    // still awaiting their run cannot.
    const { left } = await this.#clean(undefined, { reserve: wanted });
    // What it keeps is named by no record until its manifest is written, and
    // stays kept until then, whatever applies the budget meanwhile.
    const capturing = new Set<string>();
    this.#capturing.add(capturing);
    try {
      const files = await captureFiles(root, changes, {
        room: left,
        pieces: this.#pieces,
        kept: (digest) => capturing.add(digest),
      });
      const manifest: Manifest = {
        version: 1,
        actionId,
        conversationId,
        workspaceRoot: root,
        createdAt: this.#now().toISOString(),
        phase: "prepared",
        files,
      };
      await this.#beforeManifest?.();
      await this.#manifests.write(folder, manifest);
      this.#prepared.set(actionId, manifest);
      return {
        actionId,
        files: files.map(({ path, status, reason, tooLarge }) => ({
          path,
          status,
          ...(reason ? { reason } : {}),
          ...(tooLarge ? { tooLarge } : {}),
        })),
      };
    } finally {
      this.#capturing.delete(capturing);
    }
  }

  async validate(actionId: string) {
    const manifest = await this.#manifest(actionId);
    if (!manifest || manifest.phase !== "prepared")
      return {
        ok: false as const,
        reason: "The recovery capture is no longer available.",
      };
    return stillAsCaptured(manifest);
  }

  async commit(actionId: string): Promise<void> {
    const folder = this.#manifests.folderOf(actionId);
    const manifest = await this.#manifest(actionId);
    if (!manifest || manifest.phase !== "prepared") return;
    const committed: Manifest = {
      ...manifest,
      phase: "committed",
      files: await leftBehind(manifest),
    };
    await this.#manifests.write(folder, committed);
    this.#prepared.delete(actionId);
    await this.#clean(folder);
  }

  async keepCommandChanges(
    actionId: string,
    workspaceRoot: string,
    changes: readonly CommandFileChange[],
    conversationId: string,
  ): Promise<void> {
    if (!changes.length) return;
    const root = await realpath(workspaceRoot).catch(() => undefined);
    if (root === undefined) return;
    const files = await commandFiles(
      root,
      changes,
      this.#given.fileBytes ?? 256 * mib,
    );
    if (!files.length) return;
    const folder = this.#manifests.folderOf(actionId);
    await mkdir(folder, { recursive: true });
    await this.#manifests.write(folder, {
      version: 1,
      actionId,
      conversationId,
      workspaceRoot: root,
      createdAt: this.#now().toISOString(),
      phase: "committed",
      files,
    });
  }

  copyFolder(
    actionId: string,
    workspaceRoot: string,
    conversationId: string,
    options: {
      readonly begins?: boolean;
      readonly outside?: boolean;
      readonly without?: readonly string[];
    } = {},
  ): Promise<FolderCopy> {
    return this.#copying.run(async (): Promise<FolderCopy> => {
      const root = await realpath(workspaceRoot).catch(() => undefined);
      if (root === undefined)
        return {
          ok: false,
          reason: options.outside
            ? `${workspaceRoot} could not be opened.`
            : "The conversation's folder could not be opened.",
        };
      const planned = await this.#copies.plan(root, options.without);
      if (!planned.ok) return planned;
      const { plan } = planned;
      // Until what was readied is kept for the action, what it found saved
      // already stays, whatever other work applies the budget meanwhile.
      this.#copies.reserve([...plan.known.values()].map((file) => file.digest));
      // Without a watch, every file is saved now, within the budget's room.
      const wanted = this.#writes.watching
        ? 0
        : plan.wanted.reduce((sum, [, file]) => sum + file.size, 0);
      const { left } = await this.#clean(undefined, { reserve: wanted });
      const copy = await this.#copies.take(
        actionId,
        conversationId,
        plan,
        options.begins === true,
        options.outside === true,
        left,
      );
      await this.#clean();
      return copy;
    });
  }

  async keepFolderChanges(
    actionId: string,
  ): Promise<CommandFileChanges | undefined> {
    const found = await this.#copies.changes(actionId);
    if (!found) return undefined;
    if (found.files.length)
      await this.#manifests.write(
        this.#manifests.folderOf(actionId),
        runManifest(actionId, found, await this.#manifest(actionId), this.#now),
      );
    // Contents what was readied named and no change needs may go.
    await this.#clean();
    return found.shown;
  }

  async discard(actionId: string): Promise<void> {
    await this.#copies.forget(actionId);
    this.#prepared.delete(actionId);
    await this.#manifests.remove(this.#manifests.folderOf(actionId));
  }

  review(
    reviewId: string,
    workspaceRoot: string,
    actions: readonly TaskAction[],
  ): Promise<RecoveryReview> {
    return reviewActions(
      {
        manifest: (actionId) => this.#manifest(actionId),
        copyOf: (actionId, file) =>
          file.backup
            ? { backup: join(this.#manifests.folderOf(actionId), file.backup) }
            : file.content
              ? { content: file.content }
              : undefined,
      },
      reviewId,
      workspaceRoot,
      actions,
    );
  }

  async restore(review: RecoveryReview): Promise<RewindCommitResult> {
    // Zhiyin puts these files back itself, so it never waits on its own watch.
    await this.#writes.settle(review.targets.map((target) => target.absolute));
    return restoreReview(
      this.#root,
      review,
      this.#materialize,
      this.#restoreCalls,
    );
  }

  readonly #materialize: Materialize = async (digest) => {
    const folder = join(this.#content, "restoring");
    await mkdir(folder, { recursive: true });
    const path = join(folder, randomUUID());
    await this.#pieces.materialize(digest, path);
    return { path, done: () => rm(path, { force: true }) };
  };

  async versions(
    workspaceRoot: string,
    actions: readonly TaskAction[],
    path: string,
  ): Promise<FileVersions> {
    return versionsIn(
      await this.review("versions", workspaceRoot, actions),
      path,
      (digest) => this.#pieces.read(digest),
    );
  }

  /**
   * Applies the undo budget. A folder a capture left without its manifest
   * goes when the store is first read. An action still being prepared or
   * awaiting its run is never touched.
   */
  async cleanup(): Promise<void> {
    await this.#clean();
  }

  async beginTurn(
    conversationId: string,
    folders: readonly string[],
  ): Promise<TurnStart> {
    // Without a watch, each run's folder is saved as the run is readied.
    if (!this.#writes.watching) return { folders: [] };
    const found: string[] = [];
    for (const [index, folder] of folders.entries()) {
      const root = await realpath(folder).catch(() => undefined);
      if (root) found.push(root);
      // Without its workspace, a turn keeps nothing of the folders outside it.
      else if (index === 0) return { folders: [] };
    }
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const [workspace, ...outside] = found as [string, ...string[]];
    const roots = [workspace];
    for (const folder of outside)
      if (
        !roots.some((root) => same(root, folder)) &&
        !found.some((other) => !same(other, folder) && holds(other, folder))
      )
        roots.push(folder);
    const started: { root: string; copy: FolderCopy }[] = [];
    for (const root of roots) {
      const without = same(root, workspace)
        ? []
        : roots.filter((other) => !same(other, root) && holds(root, other));
      const copy = await this.#copying.run(() =>
        this.#copies.beginTurn(root, without),
      );
      started.push({ root, copy });
    }
    // Begun again while it goes on, as at a message the person added: a
    // folder it no longer names ends with the turn before.
    const before = this.#turns.get(conversationId) ?? [];
    this.#turns.set(conversationId, roots);
    for (const root of before)
      if (![...this.#turns.values()].some((other) => other.includes(root)))
        this.#copies.endTurn(root);
    await this.#clean();
    return { folders: started };
  }

  async endTurn(conversationId: string): Promise<void> {
    const roots = this.#turns.get(conversationId) ?? [];
    this.#turns.delete(conversationId);
    for (const root of roots)
      if (![...this.#turns.values()].some((other) => other.includes(root)))
        this.#copies.endTurn(root);
  }

  async prepareChange(
    workspaceRoot: string,
    path: string,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: string }
  > {
    const root = await realpath(workspaceRoot).catch(() => undefined);
    if (!root)
      return {
        ok: false,
        reason: "The conversation's folder could not be opened.",
      };
    const named = path.replaceAll("\\", "/");
    const absolute = await safeAbsolute(root, named).catch(() => undefined);
    if (!absolute)
      return { ok: false, reason: `${named} is not a file inside the folder.` };
    const found = await stat(absolute).catch(() => undefined);
    if (!found?.isFile())
      return { ok: false, reason: `${named} is not a file.` };
    const { left } = await this.#clean(undefined, { reserve: found.size });
    if (found.size > left)
      return {
        ok: false,
        reason: `The undo budget has too little room left to keep ${named} first.`,
      };
    const outcome = await this.#copying.run(() =>
      this.#copies.save(root, named),
    );
    return "failed" in outcome
      ? { ok: false, reason: outcome.failed }
      : { ok: true };
  }

  async forgetActions(actionIds: readonly string[]): Promise<void> {
    for (const actionId of actionIds) {
      if (this.#prepared.has(actionId)) continue;
      await this.#manifests.remove(this.#manifests.folderOf(actionId));
    }
    await this.#clean();
  }

  async undoBudget(): Promise<UndoBudget> {
    const budget = await this.#budgetNow();
    return {
      budgetBytes: budget.bytes,
      usedBytes: await this.#used(),
      chosen: budget.chosen,
    };
  }

  async setUndoBudget(bytes: number): Promise<UndoBudget> {
    const chosen = Math.max(0, Math.floor(bytes));
    await mkdir(this.#content, { recursive: true });
    await replaceFile(
      join(this.#content, "budget.json"),
      JSON.stringify({ version: 1, bytes: chosen, chosen: true }),
    );
    this.#budget = Promise.resolve({ bytes: chosen, chosen: true });
    this.#budgetKept = true;
    await this.#clean();
    return this.undoBudget();
  }

  #used(): Promise<number> {
    return this.#pieces.used();
  }

  /**
   * The budget: the one given, else the one kept, the person's or the
   * default taken from the disk's free space the first time recovery needed
   * it. When the free space cannot be read, nothing is kept past what is
   * needed now, and the default is taken again at the next start.
   */
  #budgetNow(): Promise<{ bytes: number; chosen: boolean }> {
    const given = this.#given.totalBytes;
    const file = join(this.#content, "budget.json");
    this.#budget ??=
      given !== undefined
        ? Promise.resolve({ bytes: given, chosen: false })
        : readFile(file, "utf8")
            .then((text) => {
              const kept = JSON.parse(text) as {
                bytes?: unknown;
                chosen?: unknown;
              };
              if (typeof kept.bytes !== "number") throw new Error("No budget.");
              return { bytes: kept.bytes, chosen: kept.chosen !== false };
            })
            .then(
              (kept) => {
                this.#budgetKept = true;
                return kept;
              },
              async () => {
                const free = await this.#freeBytes().catch(() => undefined);
                if (free === undefined) {
                  this.#budgetKept = true;
                  return { bytes: 0, chosen: false };
                }
                return { bytes: defaultBudget(free), chosen: false };
              },
            );
    return this.#budget;
  }

  /**
   * Keeps the default budget once recovery keeps anything, so the room its
   * store takes never shrinks the budget at a later start.
   */
  async #keepDefaultBudget(bytes: number): Promise<void> {
    if (this.#budgetKept || this.#given.totalBytes !== undefined) return;
    if (!(await stat(this.#content).catch(() => undefined))?.isDirectory())
      return;
    this.#budgetKept = true;
    await replaceFile(
      join(this.#content, "budget.json"),
      JSON.stringify({ version: 1, bytes, chosen: false }),
    ).catch(() => (this.#budgetKept = false));
  }

  /** The budget, sparing `spared`; see `applyLimits`. */
  async #clean(
    spared?: string,
    room?: {
      readonly reserve?: number;
      readonly originals?: boolean;
      readonly purge?: boolean;
    },
  ): Promise<{ readonly left: number }> {
    const budget = (await this.#budgetNow()).bytes;
    await this.#keepDefaultBudget(budget);
    const applied = await applyLimits(
      {
        kept: () => this.#manifests.kept(),
        budget,
        inUse: (folder) => this.#inUse(folder),
        pieces: this.#pieces,
        copies: this.#copies,
        writes: this.#writes,
        writeManifest: (folder, manifest) =>
          this.#manifests.write(folder, manifest),
        capturing: new Set(
          [...this.#capturing].flatMap((capture) => [...capture]),
        ),
      },
      spared,
      room,
    );
    this.#writes.room(applied.left);
    if (applied.released.length) this.#released?.(applied.released);
    return applied;
  }

  async forgetConversation(conversationId: string): Promise<void> {
    const kept = await this.#manifests.kept();
    for (const [folder, manifest] of [...kept]) {
      if (manifest.conversationId !== conversationId) continue;
      this.#prepared.delete(manifest.actionId);
      await this.#manifests.remove(folder);
    }
    await this.#copies.forgetConversation(conversationId);
    // What was known of a folder holds its files as they are: kept only for
    // a folder another conversation's actions are in.
    const used = new Set(
      [...(await this.#manifests.kept()).values()].map((manifest) =>
        manifest.workspaceRoot.toLowerCase(),
      ),
    );
    for (const mirror of await this.#copies.mirrors())
      if (!mirror.waiting && !used.has(mirror.root.toLowerCase()))
        await this.#copies.dropMirror(mirror.key);
    // What only its actions named goes with them, out of the store's files.
    await this.#clean(undefined, { purge: true });
  }

  /** Lets go of every watched file and closes the store. */
  async close(): Promise<void> {
    await this.#writes.close();
    await this.#pieces.close();
  }

  #whoseTurn(root: string): { readonly conversationId?: string } {
    for (const [conversationId, roots] of this.#turns)
      if (roots.some((each) => each.toLowerCase() === root.toLowerCase()))
        return { conversationId };
    return {};
  }

  /** Whether an action in this folder is being prepared or awaits its run. */
  #inUse(folder: string): boolean {
    return (
      this.#preparing.has(folder) ||
      [...this.#prepared.keys()].some(
        (actionId) => this.#manifests.folderOf(actionId) === folder,
      )
    );
  }

  /** An action's manifest: prepared in this session, or kept. */
  async #manifest(actionId: string): Promise<Manifest | undefined> {
    return this.#prepared.get(actionId) ?? (await this.#manifests.of(actionId));
  }
}
