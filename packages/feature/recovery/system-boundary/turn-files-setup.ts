/**
 * What the system-boundary tests of a turn's files share: their temporary
 * folders and app containers, the recoveries they open, and helpers to list,
 * write and measure what they keep. Each test file closes what it opened.
 */

import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { open as openFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { sourceWatchThread } from "@zhiyin/file-watch";
import { Contained } from "@zhiyin/sandbox/testing";
import { TemporaryFolders } from "@zhiyin/test-support";
import type { ListedFile, ListWorkspace, TaskAction } from "@zhiyin/contract";
import { FileRecovery } from "../src/index.js";

export const folders = new TemporaryFolders();
export const contained = new Contained(folders);
/** The recoveries a test opened, closed after it. */
export const open: FileRecovery[] = [];

export const mib = 1024 * 1024;
export const gib = 1024 * mib;

/**
 * Writes `size` bytes of noise to `path` a chunk at a time and gives their
 * SHA-256, so a large file is checked byte for byte without being held whole.
 */
export async function writeNoise(path: string, size: number): Promise<string> {
  const hash = createHash("sha256");
  const file = await openFile(path, "w");
  try {
    for (let written = 0; written < size; written += 64 * mib) {
      const chunk = randomBytes(Math.min(64 * mib, size - written));
      hash.update(chunk);
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  return hash.digest("hex");
}

/** The SHA-256 of a file's bytes, read a chunk at a time. */
export async function digestOf(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 16 * mib }))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Every file with its size, time of last change and identity, as the app lists them. */
export const list: ListWorkspace = async (root) => {
  const files = new Map<string, ListedFile>();
  const pending = [root];
  for (let next = pending.pop(); next; next = pending.pop())
    for (const entry of await readdir(next, { withFileTypes: true })) {
      const path = join(next, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        const found = await stat(path, { bigint: true });
        files.set(relative(root, path).replaceAll("\\", "/"), {
          size: Number(found.size),
          modified: Number(found.mtimeNs) / 1e6,
          id: String(found.ino),
        });
      }
    }
  return { ok: true, files };
};

export const ran = (id: string, sequence: number): TaskAction => ({
  id,
  action: "Run a Python script",
  target: "a script",
  status: "completed",
  sequence,
});

export function started(storage: string, budget = 8 * gib) {
  const recovery = new FileRecovery(storage, {
    list,
    watch: sourceWatchThread,
    limits: { totalBytes: budget },
  });
  open.push(recovery);
  return recovery;
}

/** What the store of versions takes on disk, every file of it. */
export async function storeBytes(storage: string): Promise<number> {
  let total = 0;
  const pending = [join(storage, "recovery")];
  for (let next = pending.pop(); next; next = pending.pop())
    for (const entry of await readdir(next, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(next, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else total += (await stat(path)).size;
    }
  return total;
}
