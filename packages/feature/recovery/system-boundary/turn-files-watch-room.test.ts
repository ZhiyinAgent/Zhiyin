/**
 * A turn's files past the room the watch has (ADR 0031): with the real watch
 * and programs in real app containers, tens of thousands of files, the small
 * saved at once and the large left for prepare_change. They fill the file
 * system and the watch every other test shares, so they run alone.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sourceWatchThread } from "@zhiyin/file-watch";
import { replaceFile } from "@zhiyin/files";
import { readOnlyHolds, runProcess } from "@zhiyin/sandbox";
import { bundledRipgrep, listFiles } from "@zhiyin/workspace-listing";
import type { ListWorkspace } from "@zhiyin/contract";
import { FileRecovery, RunBackups } from "../src/index.js";
import {
  contained,
  folders,
  gib,
  mib,
  open,
  ran,
  started,
} from "./turn-files-setup.js";

afterEach(async () => {
  for (const recovery of open.splice(0)) await recovery.close();
});
afterAll(async () => {
  contained.forget();
  await folders.removeAll();
});

describe(
  "a turn's files, changed by a contained program",
  { timeout: 300_000 },
  () => {
    it("watches no more than 20,000 files: past that it saves the small ones at once and leaves the largest to prepare_change", async () => {
      const many = await folders.make("zhiyin-turn-files-many-");
      const root = await folders.make("zhiyin-turn-files-cap-");
      const storage = await folders.make("zhiyin-turn-files-cap-store-");
      // 19,999 files watched in one conversation's folder leave room for one.
      for (let at = 0; at < 19_999; at += 1)
        await writeFile(join(many, `${at}.txt`), `note ${at}`);
      const large = (fill: number) => Buffer.alloc(5 * 1024 * 1024, fill);
      await writeFile(join(root, "notes.txt"), "small notes");
      await writeFile(join(root, "a.bin"), large(1));
      await writeFile(join(root, "b.bin"), Buffer.concat([large(2), large(2)]));
      const recovery = started(storage);
      const confined = await contained.grant(root);
      await recovery.beginTurn("conversation-1", [many]);

      const turn = await recovery.beginTurn("conversation-2", [root]);

      expect(turn.folders[0]?.copy).toEqual({
        ok: true,
        uncopied: [
          {
            path: "b.bin",
            reason:
              "Too many files here are not saved yet to watch them all, and it is too large to save at once. Ask for it with prepare_change before changing it.",
          },
        ],
      });
      expect(await recovery.prepareChange(root, "b.bin")).toEqual({ ok: true });
      await recovery.copyFolder("run-1", root, "conversation-2", {
        begins: true,
      });
      await contained.run(confined, [
        ["write", join(root, "notes.txt")],
        ["write", join(root, "a.bin")],
        ["write", join(root, "b.bin")],
      ]);
      await recovery.keepFolderChanges("run-1");
      await recovery.endTurn("conversation-2");
      await recovery.endTurn("conversation-1");
      const review = await recovery.review("review", root, [ran("run-1", 0)]);
      await recovery.restore(review);

      expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
        "small notes",
      );
      expect((await readFile(join(root, "a.bin"))).equals(large(1))).toBe(true);
      expect(
        (await readFile(join(root, "b.bin"))).equals(
          Buffer.concat([large(2), large(2)]),
        ),
      ).toBe(true);
    }, 300_000);

    it("keeps a folder of 60,000 files as the turn found it: the small saved at once past the watch's room, the large held from a sealed-off run until prepare_change saves one", async () => {
      const busy = await folders.make("zhiyin-turn-files-busy-");
      const root = await folders.make("zhiyin-turn-files-60k-");
      const storage = await folders.make("zhiyin-turn-files-60k-store-");
      const data = await folders.make("zhiyin-turn-files-60k-data-");
      // A thousand files a folder, written 500 at a time.
      const write = async (folder: string, count: number, text: string) => {
        for (let start = 0; start < count; start += 500) {
          const sub = join(folder, `part-${Math.floor(start / 1000)}`);
          await mkdir(sub, { recursive: true });
          await Promise.all(
            Array.from({ length: Math.min(500, count - start) }, (_, offset) =>
              writeFile(
                join(sub, `${start + offset}.txt`),
                `${text} ${start + offset}\n`,
              ),
            ),
          );
        }
      };
      // Another conversation's turn watches as many files as are watched at once.
      await write(busy, 20_000, "watched elsewhere");
      await write(root, 60_000, "a small note");
      const large = ["one", "two", "three"].map(() => randomBytes(8 * mib));
      for (const [index, bytes] of large.entries())
        await writeFile(join(root, `large-${index}.bin`), bytes);
      let wholeListings = 0;
      const real = (await realpath(root)).toLowerCase();
      const listed: ListWorkspace = (folder, part) => {
        if (!part && folder.toLowerCase() === real) wholeListings += 1;
        return listFiles(
          {
            search: { rg: bundledRipgrep()!, run: runProcess },
            upTo: 20_000,
            kept: 200,
          },
          folder,
          { ignored: true, all: true, ...(part ? { part } : {}) },
        );
      };
      const recovery = new FileRecovery(storage, {
        list: listed,
        watch: sourceWatchThread,
        limits: { totalBytes: 8 * gib },
      });
      open.push(recovery);
      const backups = new RunBackups(recovery, {
        holds: readOnlyHolds(data, { replace: replaceFile }),
        programLocations: async () => [],
        startupFolders: () => [],
      });
      const confined = await contained.grant(root);
      const waits: number[] = [];
      const run = async (id: string, ops: (readonly string[])[]) => {
        const began = performance.now();
        await backups.backUp(id, root, "conversation-2");
        const start = await backups.start(id, { sealed: true, writable: [] });
        waits.push(Math.round(performance.now() - began));
        const done = await contained.run(confined, ops);
        await backups.finish(id);
        return { start, done: done.map(({ result }) => result) };
      };
      await recovery.beginTurn("conversation-1", [busy]);

      const turn = await recovery.beginTurn("conversation-2", [root]);
      const first = await run("run-1", [
        ["write", join(root, "part-7", "7123.txt")],
        ["write", join(root, "large-1.bin")],
      ]);
      expect(await recovery.prepareChange(root, "large-1.bin")).toEqual({
        ok: true,
      });
      const second = await run("run-2", [
        ["write", join(root, "large-1.bin")],
        ["write", join(root, "large-2.bin")],
      ]);
      // A run with nothing changed since the last finds so from the change
      // journal, without listing the folder again.
      const third = await run("run-3", []);
      await recovery.endTurn("conversation-2");
      await recovery.endTurn("conversation-1");

      console.info(
        `60,000 files: each run waited ${waits.join(", ")} ms for its copies`,
      );
      expect(third.start.ok).toBe(true);
      // Listed whole once, as the turn began; each run after only where the
      // journal said something changed.
      expect(wholeListings).toBe(1);
      // Every small file was saved; the large ones wait for prepare_change.
      const copy = turn.folders[0]!.copy;
      if (!copy.ok) throw new Error(copy.reason);
      expect(
        [...copy.uncopied].sort((a, b) => a.path.localeCompare(b.path)),
      ).toEqual(
        [0, 1, 2].map((index) => ({
          path: `large-${index}.bin`,
          reason:
            "Too many files here are not saved yet to watch them all, and it is too large to save at once. Ask for it with prepare_change before changing it.",
        })),
      );
      const held = (start: typeof first.start) =>
        start.ok ? start.held.map(({ path }) => path).sort() : start.reason;
      expect(held(first.start)).toEqual([
        "large-0.bin",
        "large-1.bin",
        "large-2.bin",
      ]);
      expect(first.done[0]).toBe("done");
      expect(first.done[1]).not.toBe("done");
      expect(held(second.start)).toEqual(["large-0.bin", "large-2.bin"]);
      expect(second.done[0]).toBe("done");
      expect(second.done[1]).not.toBe("done");
      const review = await recovery.review("review", root, [
        ran("run-1", 0),
        ran("run-2", 1),
      ]);
      await recovery.restore(review);
      expect(await readFile(join(root, "part-7", "7123.txt"), "utf8")).toBe(
        "a small note 7123\n",
      );
      for (const [index, bytes] of large.entries())
        expect(
          (await readFile(join(root, `large-${index}.bin`))).equals(bytes),
        ).toBe(true);
    }, 600_000);
  },
);
