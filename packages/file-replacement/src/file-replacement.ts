/**
 * Replacing a file whole.
 *
 * The new contents are written to a file of their own beside the old one,
 * put on disk, and only then renamed into its place, so whoever reads the file
 * finds the old contents or the new, never part of either, even after a crash
 * or a power cut. A replacement that fails at any step removes what it wrote.
 */

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { renameReplacingOpenFile } from "./windows-rename.js";

/** What a file is replaced with: text, as UTF-8, bytes, or another file's bytes. */
export type FileContents = string | Uint8Array | { readonly copyOf: string };

type WrittenFile = {
  readonly write: (bytes: Uint8Array) => Promise<void>;
  readonly sync: () => Promise<void>;
  readonly close: () => Promise<void>;
};

/** The few file operations a replacement takes, in the order it takes them. */
export type ReplacementFiles = {
  /** Creates a file that must not exist yet. */
  readonly open: (path: string) => Promise<WrittenFile>;
  readonly rename: (
    from: string,
    to: string,
    signal: AbortSignal | undefined,
  ) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
};

/** How long a rename waits for a file another program holds open. */
const longestWaitMs = 2_000;

/**
 * Renames over the file being replaced. A program reading it, as a reader of
 * the same file, an indexer or a virus scanner does, keeps what it opened and
 * does not stand in the way. One that holds it without letting it be
 * replaced, as some editors do, is waited for, up to two seconds. Where
 * Windows cannot rename over an open file, as on some drives and shares,
 * Node's rename is used, waiting the same way. A stop ends the wait.
 */
async function renameWhenFree(
  from: string,
  to: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const deadline = Date.now() + longestWaitMs;
  for (let delay = 10; ; delay = Math.min(delay * 2, 200)) {
    signal?.throwIfAborted();
    const answer = renameReplacingOpenFile(from, to);
    if (answer === "replaced") return;
    if (answer === "other")
      try {
        await rename(from, to);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const held = code === "EPERM" || code === "EACCES" || code === "EBUSY";
        if (!held || Date.now() >= deadline) throw error;
      }
    else if (Date.now() >= deadline)
      throw Object.assign(
        new Error(
          `EBUSY: another program has ${to} open, so it was not replaced`,
        ),
        { code: "EBUSY", path: to },
      );
    await setTimeout(
      Math.max(1, Math.min(delay, deadline - Date.now())),
      undefined,
      signal ? { signal } : {},
    );
  }
}

const diskFiles: ReplacementFiles = {
  open: async (path) => {
    const handle = await open(path, "wx");
    return {
      write: async (bytes) => {
        await handle.writeFile(bytes);
      },
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
  rename: renameWhenFree,
  remove: (path) => rm(path, { force: true, maxRetries: 3 }),
};

async function* chunksOf(
  contents: FileContents,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted();
  if (typeof contents === "string") yield Buffer.from(contents, "utf8");
  else if (contents instanceof Uint8Array) yield contents;
  else
    for await (const chunk of createReadStream(contents.copyOf, {
      ...(signal ? { signal } : {}),
    }))
      yield chunk as Buffer;
}

export function replacingWith(files: ReplacementFiles) {
  return async function replace(
    path: string,
    contents: FileContents,
    options: {
      readonly signal?: AbortSignal | undefined;
      /** Asked of the written file before it takes the old one's place. */
      readonly check?: ((written: string) => Promise<void>) | undefined;
    } = {},
  ): Promise<void> {
    const { signal, check } = options;
    signal?.throwIfAborted();
    // A name of fixed length, so a file whose own name is as long as a name
    // may be can still be replaced.
    const temporary = join(dirname(path), `.zhiyin-${randomUUID()}.tmp`);
    let created = false;
    try {
      const file = await files.open(temporary);
      created = true;
      try {
        for await (const chunk of chunksOf(contents, signal)) {
          signal?.throwIfAborted();
          await file.write(chunk);
        }
        await file.sync();
      } finally {
        await file.close();
      }
      await check?.(temporary);
      signal?.throwIfAborted();
      await files.rename(temporary, path, signal);
    } catch (error) {
      if (created) await files.remove(temporary).catch(() => undefined);
      throw error;
    }
  };
}

/**
 * Replaces the file at `path` with `contents`, or creates it. Its folder must
 * exist. Stopped by `signal` before the rename, or refused by `check`, it
 * leaves the old file as it was.
 */
export const replaceFile = replacingWith(diskFiles);
