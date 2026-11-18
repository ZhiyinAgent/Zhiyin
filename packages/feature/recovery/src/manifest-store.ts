/**
 * The record of each kept action: a folder of its own holding its manifest
 * and the copies taken for it. The records are read from disk once, at the
 * first use, and kept current by every write and removal after it, so a
 * change never reads them all again.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { replaceFile } from "@zhiyin/files";
import type { FolderCopies } from "./folder-copies.js";
import { isManifest, type CapturedFile, type Manifest } from "./records.js";
import { kind } from "./workspace-files.js";

/** The store's own folders beside those of each action. */
const sharedFolders = new Set(["content", "folders", "runs"]);

/** What a run changed in its folders, found against their copies. */
type FoundChanges = {
  readonly root: string;
  readonly conversationId: string;
  readonly files: readonly CapturedFile[];
};

/**
 * The record of what a run changed. A change the action declared keeps its
 * own copy, taken and checked before approval; the rest of the folder's are
 * added beside it.
 */
export function runManifest(
  actionId: string,
  found: FoundChanges,
  existing: Manifest | undefined,
  now: () => Date,
): Manifest {
  const declared = new Set(existing?.files.map((file) => file.path));
  return {
    version: 1,
    actionId,
    conversationId: found.conversationId,
    workspaceRoot: found.root,
    createdAt: existing?.createdAt ?? now().toISOString(),
    phase: "committed",
    run: true,
    files: [
      ...(existing?.files ?? []),
      ...found.files.filter((file) => !declared.has(file.path)),
    ],
  };
}

export class ManifestStore {
  readonly #root: string;
  readonly #copies: FolderCopies;
  readonly #now: () => Date;
  readonly #inUse: (folder: string) => boolean;
  /** Every kept action's manifest by its folder, once read. */
  #index: Promise<Map<string, Manifest>> | undefined;

  constructor(options: {
    /** The store's folder, holding a folder per action. */
    readonly root: string;
    /** The copies of folders, whose runs a restart may have cut short. */
    readonly copies: FolderCopies;
    readonly now: () => Date;
    /** Whether an action in this folder is being prepared or awaits its run. */
    readonly inUse: (folder: string) => boolean;
  }) {
    this.#root = options.root;
    this.#copies = options.copies;
    this.#now = options.now;
    this.#inUse = options.inUse;
  }

  /** The folder an action's manifest and copies are kept in. */
  folderOf(actionId: string): string {
    return join(
      this.#root,
      createHash("sha256").update(actionId).digest("hex"),
    );
  }

  /** The kept manifest of an action, if any. */
  async of(actionId: string): Promise<Manifest | undefined> {
    return (await this.kept()).get(this.folderOf(actionId));
  }

  /** The index of kept actions, read from disk the first time it is asked for. */
  kept(): Promise<Map<string, Manifest>> {
    if (!this.#index) {
      this.#index = this.#read();
      this.#index.catch(() => (this.#index = undefined));
    }
    return this.#index;
  }

  /** Writes an action's manifest whole and keeps it in the index. */
  async write(folder: string, manifest: Manifest): Promise<void> {
    await mkdir(folder, { recursive: true });
    await replaceFile(join(folder, "manifest.json"), JSON.stringify(manifest));
    (await this.kept()).set(folder, manifest);
  }

  /** Removes an action's folder, its manifest and copies with it. */
  async remove(folder: string): Promise<void> {
    await rm(folder, { recursive: true, force: true });
    (await this.kept()).delete(folder);
  }

  /**
   * Reads every kept action's manifest. A folder a capture left without its
   * manifest, when Zhiyin closed mid-capture, holds copies nothing names and
   * is removed.
   */
  async #read(): Promise<Map<string, Manifest>> {
    const kept = new Map<string, Manifest>();
    for (const item of await this.#folders()) {
      if (item.manifest) kept.set(item.folder, item.manifest);
      else if (
        !this.#inUse(item.folder) &&
        (await kind(join(item.folder, "manifest.json"))) === "absent"
      )
        await rm(item.folder, { recursive: true, force: true });
    }
    // A run Zhiyin stopped with, by a crash or by quitting while it went on,
    // is recorded now against the copy taken before it, as it left the
    // folder, or as the folder is if anything changed it since. One that
    // never began, as when Zhiyin stopped while it awaited approval, changed
    // nothing, and what was kept for it goes.
    const left = await this.#copies.leftOver();
    for (const actionId of left.unbegun) {
      const folder = this.folderOf(actionId);
      await rm(folder, { recursive: true, force: true });
      kept.delete(folder);
    }
    for (const actionId of left.cut) {
      const found = await this.#copies.changes(actionId).catch(() => undefined);
      if (!found?.files.length) continue;
      const folder = this.folderOf(actionId);
      const manifest = runManifest(
        actionId,
        found,
        kept.get(folder),
        this.#now,
      );
      await mkdir(folder, { recursive: true });
      await replaceFile(
        join(folder, "manifest.json"),
        JSON.stringify(manifest),
      );
      kept.set(folder, manifest);
    }
    return kept;
  }

  /** Each action's folder, with its manifest when one can be read. */
  async #folders(): Promise<
    { readonly folder: string; readonly manifest?: Manifest }[]
  > {
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(
      // The copies kept by their contents, and what was copied of each
      // folder, sit beside the actions' folders under names of their own.
      names
        .filter((name) => !sharedFolders.has(name))
        .map(async (name) => {
          const folder = join(this.#root, name);
          // A manifest that cannot be read, or is not one as it is written,
          // is not trusted: the folder is left as it is, named by no record.
          const manifest = await readFile(join(folder, "manifest.json"), "utf8")
            .then((text) => JSON.parse(text) as unknown)
            .catch(() => undefined);
          return isManifest(manifest) ? { folder, manifest } : { folder };
        }),
    );
  }
}
