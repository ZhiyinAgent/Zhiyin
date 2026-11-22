/**
 * What is known of each folder's files, remembered across restarts: each
 * file's size, time and identity when its contents were last known, and
 * whether the store holds those contents. Where the drive's change journal
 * stood then is remembered with it, so a file changed since is known to be,
 * even with its old size and time. The record is only a shortcut: without
 * it, each file is watched again.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ListedFile } from "@zhiyin/contract";
import type { JournalPoint } from "@zhiyin/file-watch";
import { replaceFile } from "@zhiyin/files";
import type { Known } from "./run-changes.js";

/**
 * A file as it was last known, with the digest of what it held. `unstored`:
 * the digest is known, as a run left the file, but the store holds no copy;
 * `turn` says in which turn that was learned, and `turnStart` which version
 * that turn found.
 */
export type MirroredFile = ListedFile & {
  readonly digest: string;
  readonly unstored?: true;
  readonly turn?: number;
  readonly turnStart?: { readonly digest: string; readonly bytes: number };
};

/** What is known of one folder, as kept on disk. */
type Mirror = {
  readonly version: 1;
  readonly workspaceRoot: string;
  readonly usedAt: string;
  /** Where the change journal stood when this was last brought up to date. */
  readonly point?: JournalPoint;
  readonly files: Readonly<Record<string, MirroredFile>>;
};

/** Whether `files` holds, of those with a digest, exactly what `record` does. */
function sameFiles(
  record: Readonly<Record<string, MirroredFile>>,
  files: ReadonlyMap<string, Known>,
): boolean {
  let count = 0;
  for (const [path, file] of files) {
    if (!file.digest) continue;
    count += 1;
    const known = record[path];
    if (
      !known ||
      known.digest !== file.digest ||
      known.size !== file.size ||
      known.modified !== file.modified ||
      known.id !== file.id ||
      known.unstored !== file.unstored ||
      known.turn !== file.turn ||
      known.turnStart?.digest !== file.turnStart?.digest ||
      known.turnStart?.bytes !== file.turnStart?.bytes
    )
      return false;
  }
  return count === Object.keys(record).length;
}

/** How the copy of a folder is named in the store. */
export const folderKey = (root: string) =>
  createHash("sha256").update(root.toLowerCase()).digest("hex");

export class FolderMirrors {
  readonly #folder: string;
  readonly #now: () => Date;
  #mirrors: Promise<Map<string, Mirror>> | undefined;

  constructor(folder: string, now: () => Date) {
    this.#folder = folder;
    this.#now = now;
  }

  /** What is known of a folder's files, by path, if it is remembered. */
  async filesOf(
    root: string,
  ): Promise<Readonly<Record<string, MirroredFile>> | undefined> {
    return (await this.#loaded()).get(folderKey(root))?.files;
  }

  /** Where the change journal stood when the folder was last brought up to date. */
  async pointOf(root: string): Promise<JournalPoint | undefined> {
    return (await this.#loaded()).get(folderKey(root))?.point;
  }

  /** The digest the folder's file is last known by, sync, once read. */
  digestOf(root: string, path: string): string | undefined {
    return this.#known?.get(folderKey(root))?.files[path]?.digest;
  }

  #known: Map<string, Mirror> | undefined;

  /**
   * Remembers what is known of the folder's files now, those with a digest,
   * and where the change journal stood.
   */
  async remember(
    root: string,
    files: ReadonlyMap<string, Known>,
    point?: JournalPoint,
  ) {
    const loaded = await this.#loaded();
    const earlier = loaded.get(folderKey(root));
    // Nothing new is known: the record stands, with where the journal stood
    // when it was written, which still answers for every file it holds.
    if (earlier && sameFiles(earlier.files, files)) {
      loaded.set(folderKey(root), {
        ...earlier,
        usedAt: this.#now().toISOString(),
      });
      return;
    }
    const copied: Record<string, MirroredFile> = {};
    for (const [path, file] of files)
      if (file.digest)
        copied[path] = {
          size: file.size,
          modified: file.modified,
          digest: file.digest,
          ...(file.id ? { id: file.id } : {}),
          ...(file.unstored ? { unstored: true as const } : {}),
          ...(file.turn !== undefined ? { turn: file.turn } : {}),
          ...(file.turnStart ? { turnStart: file.turnStart } : {}),
        };
    const mirror: Mirror = {
      version: 1,
      workspaceRoot: root,
      usedAt: this.#now().toISOString(),
      ...((point ?? loaded.get(folderKey(root))?.point)
        ? { point: point ?? loaded.get(folderKey(root))!.point! }
        : {}),
      files: copied,
    };
    const key = folderKey(root);
    (await this.#loaded()).set(key, mirror);
    await mkdir(this.#folder, { recursive: true });
    await replaceFile(
      join(this.#folder, `${key}.json`),
      JSON.stringify(mirror),
    );
  }

  /** Each folder remembered, by its key, with when it was last copied and the contents its copy holds. */
  async list(): Promise<
    {
      readonly key: string;
      readonly root: string;
      readonly usedAt: number;
      readonly digests: ReadonlySet<string>;
    }[]
  > {
    return [...(await this.#loaded())].map(([key, mirror]) => ({
      key,
      root: mirror.workspaceRoot,
      usedAt: Date.parse(mirror.usedAt),
      digests: this.#digestsOf(mirror.files),
    }));
  }

  /** The contents a record names, worked out once for each record. */
  #digestsOf(files: Mirror["files"]): ReadonlySet<string> {
    let digests = this.#digests.get(files);
    if (!digests) {
      const found = new Set<string>();
      for (const file of Object.values(files)) {
        found.add(file.digest);
        if (file.turnStart) found.add(file.turnStart.digest);
      }
      this.#digests.set(files, found);
      digests = found;
    }
    return digests;
  }

  readonly #digests = new WeakMap<Mirror["files"], ReadonlySet<string>>();

  /** Forgets what was copied of a folder, so it is copied again. */
  async drop(key: string): Promise<void> {
    (await this.#loaded()).delete(key);
    await rm(join(this.#folder, `${key}.json`), { force: true });
  }

  #loaded(): Promise<Map<string, Mirror>> {
    if (!this.#mirrors) {
      this.#mirrors = this.#read();
      this.#mirrors.then(
        (mirrors) => (this.#known = mirrors),
        () => (this.#mirrors = undefined),
      );
    }
    return this.#mirrors;
  }

  async #read(): Promise<Map<string, Mirror>> {
    const mirrors = new Map<string, Mirror>();
    let names: string[];
    try {
      names = await readdir(this.#folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return mirrors;
      throw error;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const mirror = JSON.parse(
          await readFile(join(this.#folder, name), "utf8"),
        ) as Mirror;
        mirrors.set(name.slice(0, -5), mirror);
      } catch {
        // An unreadable record only means the folder is copied again.
        await rm(join(this.#folder, name), { force: true });
      }
    }
    return mirrors;
  }
}
