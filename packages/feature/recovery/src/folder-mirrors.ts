/**
 * What was copied of each folder, remembered across restarts, so a later run
 * copies only the files that changed since. The record is only a shortcut:
 * it can go to make room, at the cost of copying the folder again.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ListedFile } from "@zhiyin/contract";
import { replaceFile } from "@zhiyin/files";
import type { Known } from "./run-changes.js";

/** A file as its folder's last copy found it, with what it held. */
type MirroredFile = ListedFile & { digest: string };

/** What was copied of one folder, as kept on disk. */
type Mirror = {
  readonly version: 1;
  readonly workspaceRoot: string;
  readonly usedAt: string;
  readonly files: Readonly<Record<string, MirroredFile>>;
};

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

  /** The files the last copy of a folder held, by path, if it is remembered. */
  async filesOf(
    root: string,
  ): Promise<Readonly<Record<string, MirroredFile>> | undefined> {
    return (await this.#loaded()).get(folderKey(root))?.files;
  }

  /** Remembers what the folder's copy holds now. */
  async remember(root: string, files: ReadonlyMap<string, Known>) {
    const copied: Record<string, MirroredFile> = {};
    for (const [path, file] of files)
      if (file.digest)
        copied[path] = {
          size: file.size,
          modified: file.modified,
          digest: file.digest,
        };
    const mirror: Mirror = {
      version: 1,
      workspaceRoot: root,
      usedAt: this.#now().toISOString(),
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
      readonly usedAt: number;
      readonly digests: ReadonlySet<string>;
    }[]
  > {
    return [...(await this.#loaded())].map(([key, mirror]) => ({
      key,
      usedAt: Date.parse(mirror.usedAt),
      digests: new Set(Object.values(mirror.files).map((file) => file.digest)),
    }));
  }

  /** Forgets what was copied of a folder, so it is copied again. */
  async drop(key: string): Promise<void> {
    (await this.#loaded()).delete(key);
    await rm(join(this.#folder, `${key}.json`), { force: true });
  }

  #loaded(): Promise<Map<string, Mirror>> {
    if (!this.#mirrors) {
      this.#mirrors = this.#read();
      this.#mirrors.catch(() => (this.#mirrors = undefined));
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
