/**
 * File recovery as one store: capturing a declared change, copying a
 * program's folders around its run, reviewing and restoring, and the limits
 * on what is kept, over the records of each kept action.
 */

import { mkdir, realpath, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import { Serial } from "@zhiyin/one-at-a-time";
import type {
  CommandFileChange,
  CommandFileChanges,
  FileChange,
  ListWorkspace,
  RewindCommitResult,
  TaskAction,
} from "@zhiyin/contract";
import {
  captureFiles,
  commandFiles,
  leftBehind,
  protectedBytes,
  stillAsCaptured,
} from "./capture.js";
import { ContentStore } from "./content-store.js";
import { FolderCopies, type FolderCopy } from "./folder-copies.js";
import { ManifestStore, runManifest } from "./manifest-store.js";
import type { Manifest } from "./records.js";
import { restoreReview } from "./restore.js";
import {
  reviewActions,
  versionsIn,
  type FileVersions,
  type RecoveryReview,
} from "./review.js";
import {
  applyLimits,
  recoveryTotal,
  type RecoveryLimits,
} from "./storage-limits.js";

export type { RecoveryLimits } from "./storage-limits.js";

export type { FolderCopy } from "./folder-copies.js";

export type { FileVersions, RecoveryReview } from "./review.js";

const mib = 1024 * 1024;

/** The total is set from the disk's free space as recovery is first used. */
const defaults: Omit<RecoveryLimits, "totalBytes"> = {
  fileBytes: 256 * mib,
  versionsPerPath: 10,
  maximumAgeMs: 30 * 24 * 60 * 60 * 1000,
};

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
    /** A file the limits could not admit, so a change to it cannot be undone. */
    readonly tooLarge?: true;
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
   * Brings the copy of a folder up to date for an action whose program may
   * change any file in it: lists the folder and copies each file new or
   * changed since the last copy, within the limits, smallest first. Asked
   * again for the same action, as just before it runs, it copies only what
   * changed since. Says which files could not be copied, or why the folder
   * could not be. `begins` marks the copy taken as the run begins: a copy
   * whose run never began is let go of at the next start.
   *
   * `outside` copies a folder outside the workspace the program is given,
   * beside the workspace's copy, leaving out the folders `without` names,
   * as the workspace is when the folder holds it. Its changes are recorded
   * by their whole paths.
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
   * its folders, against the copies taken before it ran, so going back puts
   * each back as a declared change is: in the workspace by its path there,
   * elsewhere by its whole path. Answers what changed, or nothing when no
   * copy was taken for the action.
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

export class FileRecovery implements Recovery {
  readonly #root: string;
  readonly #limits: Omit<RecoveryLimits, "totalBytes"> & {
    readonly totalBytes?: number;
  };
  readonly #freeBytes: () => Promise<number | undefined>;
  #total: Promise<number> | undefined;
  readonly #now: () => Date;
  readonly #beforeManifest: (() => Promise<void>) | undefined;
  readonly #contents: ContentStore;
  readonly #copies: FolderCopies;
  readonly #manifests: ManifestStore;
  /** Copies of folders are taken one at a time. */
  readonly #copying = new Serial();
  readonly #prepared = new Map<string, Manifest>();
  /** Folders whose copies are being taken, before they have a manifest. */
  readonly #preparing = new Set<string>();

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
       * How a folder's files are listed, to copy it before a program runs
       * in it; absent, no folder is copied.
       */
      readonly list?: ListWorkspace;
      /** The free space on recovery's disk; read from the disk by default. */
      readonly freeBytes?: () => Promise<number | undefined>;
    } = {},
  ) {
    this.#root = join(dataDirectory, "recovery");
    this.#limits = { ...defaults, ...options.limits };
    this.#freeBytes = options.freeBytes ?? (() => freeSpace(this.#root));
    this.#now = options.now ?? (() => new Date());
    this.#beforeManifest = options.beforeManifest;
    this.#contents = new ContentStore(join(this.#root, "content"));
    this.#copies = new FolderCopies({
      folder: join(this.#root, "folders"),
      runs: join(this.#root, "runs"),
      store: this.#contents,
      list: options.list,
      fileBytes: this.#limits.fileBytes,
      now: this.#now,
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
      // Copies a capture took before it failed are named by no record.
      if (!this.#prepared.has(actionId))
        await rm(folder, { recursive: true, force: true }).catch(
          () => undefined,
        );
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
    // The oldest committed copies make room for a new one once it is
    // committed; the copies of actions still awaiting their run cannot.
    const files = await captureFiles(
      root,
      changes,
      folder,
      await this.#limitsNow(),
      [...this.#prepared.values()].reduce(
        (total, manifest) => total + protectedBytes(manifest),
        0,
      ),
    );
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
    const files = await commandFiles(root, changes, this.#limits.fileBytes);
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
      const known = new Set(
        [...plan.known.values()].map((file) => file.digest),
      );
      // Until the copy is kept for the action, what it found copied already
      // stays, whatever other work applies the limits meanwhile.
      this.#copies.reserve(known);
      const room = await this.#clean(undefined, {
        reserve: plan.needed,
        folder: root,
        keep: known,
      });
      return this.#copies.take(
        actionId,
        conversationId,
        plan,
        room,
        options.begins === true,
        options.outside === true,
      );
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
    // Contents the copy named and no change needs may go.
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
            ? join(this.#manifests.folderOf(actionId), file.backup)
            : file.content
              ? this.#contents.path(file.content)
              : undefined,
      },
      reviewId,
      workspaceRoot,
      actions,
    );
  }

  restore(review: RecoveryReview): Promise<RewindCommitResult> {
    return restoreReview(this.#root, review);
  }

  async versions(
    workspaceRoot: string,
    actions: readonly TaskAction[],
    path: string,
  ): Promise<FileVersions> {
    return versionsIn(
      await this.review("versions", workspaceRoot, actions),
      path,
    );
  }

  /**
   * Applies the limits. An action past the age limit loses everything kept
   * for it, and one whose copies were evicted keeps only its record; a folder a
   * capture left without its manifest goes when the store is first read. An
   * action still being prepared or awaiting its run is never touched.
   */
  async cleanup(): Promise<void> {
    await this.#clean();
  }

  /**
   * The limits, the total read from the disk's free space the first time it
   * is needed; when that cannot be read, the least total.
   */
  #limitsNow(): Promise<RecoveryLimits> {
    const given = this.#limits.totalBytes;
    this.#total ??=
      given !== undefined
        ? Promise.resolve(given)
        : this.#freeBytes().then(
            (free) => recoveryTotal(free ?? 0),
            () => recoveryTotal(0),
          );
    return this.#total.then((totalBytes) => ({
      ...this.#limits,
      totalBytes,
    }));
  }

  /** The limits, sparing `spared`; see `applyLimits`. */
  async #clean(
    spared?: string,
    room?: Parameters<typeof applyLimits>[2],
  ): Promise<number> {
    return applyLimits(
      {
        kept: () => this.#manifests.kept(),
        limits: await this.#limitsNow(),
        now: this.#now,
        inUse: (folder) => this.#inUse(folder),
        contents: this.#contents,
        copies: this.#copies,
        writeManifest: (folder, manifest) =>
          this.#manifests.write(folder, manifest),
      },
      spared,
      room,
    );
  }

  async forgetConversation(conversationId: string): Promise<void> {
    const kept = await this.#manifests.kept();
    for (const [folder, manifest] of [...kept]) {
      if (manifest.conversationId !== conversationId) continue;
      this.#prepared.delete(manifest.actionId);
      await this.#manifests.remove(folder);
    }
    await this.#copies.forgetConversation(conversationId);
    // What only its actions named goes with them.
    await this.#clean();
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
