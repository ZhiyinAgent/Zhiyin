/**
 * Puts a bundled dictionary where the spellchecker reads it.
 *
 * Chromium reads a language's dictionary from the session's `Dictionaries`
 * folder, by its versioned name, and downloads it only when it is not there.
 * A dictionary placed there exactly as bundled is read with nothing fetched.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BundledDictionary } from "./languages.js";

/**
 * Placed, as bundled; missing from the bundle; or damaged in it, and so never
 * placed. Missing or damaged, the spellchecker downloads it if it can.
 */
export type Placement = "placed" | "missing" | "damaged";

const hashOf = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function read(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

export class DictionaryShelf {
  readonly #bundled: string;
  readonly #installed: string;

  /** `bundled` holds the dictionaries as shipped; `installed` is read. */
  constructor(folders: {
    readonly bundled: string;
    readonly installed: string;
  }) {
    this.#bundled = folders.bundled;
    this.#installed = folders.installed;
  }

  async place(dictionary: BundledDictionary): Promise<Placement> {
    const target = join(this.#installed, dictionary.file);
    const present = await read(target);
    if (present && hashOf(present) === dictionary.sha256) return "placed";
    const bundled = await read(join(this.#bundled, dictionary.file));
    if (!bundled) return "missing";
    if (hashOf(bundled) !== dictionary.sha256) return "damaged";
    // Written beside its place and renamed into it, so the spellchecker never
    // reads half a file.
    await mkdir(this.#installed, { recursive: true });
    const written = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(written, bundled);
      await rename(written, target);
    } finally {
      await rm(written, { force: true });
    }
    return "placed";
  }
}
