/**
 * Files larger than recovery once copied (ADR 0013): a scene or a data file
 * of tens of megabytes is copied before a change, so going back puts it back.
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import type { ListedFile, ListWorkspace } from "@zhiyin/contract";
import { FileRecovery, RunBackups } from "../src/index.js";
import { recoveryTotal } from "../src/storage-limits.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const mib = 1024 * 1024;
const gib = 1024 * mib;

const list: ListWorkspace = async (root) => {
  const files = new Map<string, ListedFile>();
  for (const name of await readdir(root)) {
    const found = await stat(join(root, name));
    if (found.isFile())
      files.set(name, { size: found.size, modified: found.mtimeMs });
  }
  return { ok: true, files };
};

/** Bytes that differ along the whole file, as a saved scene's do. */
function scene(bytes: number, mark: string): Buffer {
  const content = Buffer.alloc(bytes);
  for (let at = 0; at < bytes; at += 4096) content.write(`${mark}${at}`, at);
  return content;
}

const ranAt = {
  id: "run-1",
  action: "Run a script",
  target: "a script",
  status: "running",
  startedAt: "2026-11-01T10:00:00.000Z",
  sequence: 0,
} as const;

describe("a file of 20 MiB", () => {
  it("is copied before a run, held from nothing, and put back by going back", async () => {
    const root = await folders.make("zhiyin-large-workspace-");
    const storage = await folders.make("zhiyin-large-store-");
    const before = scene(20 * mib, "before");
    await writeFile(join(root, "stand.blend"), before);
    const held: string[] = [];
    const recovery = new FileRecovery(storage, {
      list,
      freeBytes: async () => 100 * gib,
    });
    const runs = new RunBackups(recovery, {
      holds: {
        async hold(_within, paths) {
          held.push(...paths.map(({ path }) => path));
          return { held: [], failed: [], release: async () => {} };
        },
      },
      programLocations: async () => [],
    });

    const copied = await runs.backUp("run-1", root, "conversation-1");
    await runs.start("run-1", { sealed: true, writable: [] });
    await writeFile(join(root, "stand.blend"), scene(20 * mib, "after"));
    await runs.finish("run-1");
    await recovery.restore(await recovery.review("review", root, [ranAt]));

    expect(copied).toMatchObject({ ok: true, uncopied: [] });
    expect(held.filter((path) => path.endsWith("stand.blend"))).toEqual([]);
    expect((await readFile(join(root, "stand.blend"))).equals(before)).toBe(
      true,
    );
  });

  it("a change declares is copied, so the change can be undone", async () => {
    const root = await folders.make("zhiyin-large-workspace-");
    const storage = await folders.make("zhiyin-large-store-");
    await writeFile(join(root, "part.step"), scene(20 * mib, "before"));
    const recovery = new FileRecovery(storage, {
      freeBytes: async () => 100 * gib,
    });

    const prepared = await recovery.prepare(
      "write-1",
      root,
      [{ path: "part.step", change: "updated" }],
      "conversation-1",
    );

    expect(prepared.files).toEqual([
      { path: "part.step", status: "protected" },
    ]);
  });
});

describe("a file past the limit for one file", () => {
  it("is not copied by a declared change, which says the limit", async () => {
    const root = await folders.make("zhiyin-large-workspace-");
    const storage = await folders.make("zhiyin-large-store-");
    await writeFile(join(root, "part.step"), "p".repeat(200));
    const recovery = new FileRecovery(storage, {
      limits: { fileBytes: 100 },
      freeBytes: async () => 100 * gib,
    });

    const prepared = await recovery.prepare(
      "write-1",
      root,
      [{ path: "part.step", change: "updated" }],
      "conversation-1",
    );

    expect(prepared.files).toEqual([
      {
        path: "part.step",
        status: "unprotected",
        reason: "The existing file exceeds the 100 byte recovery limit.",
        tooLarge: true,
      },
    ]);
  });
});

describe("everything recovery keeps", () => {
  it("is a tenth of the free space, at least 256 MiB and at most 4 GiB", () => {
    expect(recoveryTotal(10 * gib)).toBe(gib);
    expect(recoveryTotal(gib)).toBe(256 * mib);
    expect(recoveryTotal(500 * gib)).toBe(4 * gib);
  });
});
