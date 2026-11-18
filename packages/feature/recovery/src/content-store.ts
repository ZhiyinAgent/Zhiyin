/**
 * Copies kept by what they hold: one file per SHA-256 of its bytes, so the
 * same contents kept for many files, or many times, take room once.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileDigest } from "./workspace-files.js";

const named = /^[0-9a-f]{64}$/;

/** A file copied in, not yet kept. */
export type Staged = {
  readonly path: string;
  readonly bytes: number;
  readonly digest: string;
};

export class ContentStore {
  readonly #folder: string;
  /** Each kept copy's size by its digest, read from disk once. */
  #sizes: Promise<Map<string, number>> | undefined;

  constructor(folder: string) {
    this.#folder = folder;
  }

  /** Where the copy of these contents is, whether or not it is kept. */
  path(digest: string): string {
    return join(this.#folder, digest);
  }

  /** The copies kept, by digest, with their size. */
  sizes(): Promise<Map<string, number>> {
    if (!this.#sizes) {
      this.#sizes = this.#read();
      this.#sizes.catch(() => (this.#sizes = undefined));
    }
    return this.#sizes;
  }

  /**
   * Copies a file in beside what is kept, read in pieces, and answers the
   * digest and size of what was copied, so a file changing as it is copied
   * leaves no copy other than its digest says. The copy is kept by `keep`,
   * or let go of by `drop`; one left at a crash goes when the store is next
   * read.
   */
  async stage(source: string): Promise<Staged> {
    await mkdir(this.#folder, { recursive: true });
    const path = join(this.#folder, `${randomUUID()}.part`);
    try {
      await copyFile(source, path);
      return {
        path,
        bytes: (await stat(path)).size,
        digest: await fileDigest(path),
      };
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }

  /** Keeps a staged copy under its digest, or lets it go when that is kept already. */
  async keep(staged: Staged): Promise<void> {
    const sizes = await this.sizes();
    if (sizes.has(staged.digest)) return this.drop(staged);
    await rename(staged.path, this.path(staged.digest));
    sizes.set(staged.digest, staged.bytes);
  }

  async drop(staged: Staged): Promise<void> {
    await rm(staged.path, { force: true });
  }

  async remove(digest: string): Promise<void> {
    await rm(this.path(digest), { force: true });
    (await this.sizes()).delete(digest);
  }

  /** Reads what is kept; a part a write left at a crash goes. */
  async #read(): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    let names: string[];
    try {
      names = await readdir(this.#folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return sizes;
      throw error;
    }
    for (const name of names) {
      const path = join(this.#folder, name);
      if (!named.test(name)) {
        await rm(path, { force: true }).catch(() => undefined);
        continue;
      }
      const found = await stat(path).catch(() => undefined);
      if (found?.isFile()) sizes.set(name, found.size);
    }
    return sizes;
  }
}
