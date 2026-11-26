/**
 * A turn's files kept by copy on first write (ADR 0031), with the real watch
 * and programs in real app containers: from a turn's start, each file of the
 * folder is held, and a contained program that writes, renames or deletes
 * one waits until its bytes are saved. Going back puts back each file as the
 * turn found it.
 */

import { randomBytes } from "node:crypto";
import { renameSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sourceWatchThread } from "@zhiyin/file-watch";
import { FileRecovery } from "../src/index.js";
import {
  contained,
  digestOf,
  folders,
  gib,
  list,
  mib,
  open,
  ran,
  started,
  storeBytes,
  writeNoise,
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
    it("wait to be written, renamed, deleted or moved with their folder until each is saved, then go back as the turn found them; a read waits for nothing", async () => {
      const root = await folders.make("zhiyin-turn-files-");
      const storage = await folders.make("zhiyin-turn-files-store-");
      await mkdir(join(root, "data"));
      const original = {
        "notes.txt": randomBytes(8 * mib),
        "draft.txt": randomBytes(8 * mib),
        "old.txt": randomBytes(8 * mib),
        "data/table.csv": randomBytes(8 * mib),
        "read.txt": randomBytes(8 * mib),
      };
      for (const [path, bytes] of Object.entries(original))
        await writeFile(join(root, path), bytes);
      const recovery = started(storage);
      const confined = await contained.grant(root);

      await recovery.beginTurn("conversation-1", [root]);
      const copy = await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });
      const done = await contained.run(confined, [
        ["write", join(root, "notes.txt")],
        ["rename", join(root, "draft.txt"), join(root, "final.txt")],
        ["delete", join(root, "old.txt")],
        ["rename", join(root, "data"), join(root, "moved")],
        ["read", join(root, "read.txt")],
      ]);
      await recovery.keepFolderChanges("run-1");
      await recovery.endTurn("conversation-1");

      expect(copy).toEqual({ ok: true, uncopied: [] });
      expect(done.map(({ op, result }) => [op, result])).toEqual([
        ["write", "done"],
        ["rename", "done"],
        ["delete", "done"],
        ["rename", "done"],
        ["read", 8 * mib],
      ]);
      const review = await recovery.review("review", root, [ran("run-1", 0)]);
      const restored = await recovery.restore(review);
      expect(
        restored.files.filter(
          ({ status }) => status !== "restored" && status !== "removed",
        ),
      ).toEqual([]);
      for (const [path, bytes] of Object.entries(original))
        expect((await readFile(join(root, path))).equals(bytes)).toBe(true);
      expect(await readdir(root)).not.toContain("final.txt");
    });

    it("keeps a 1 GiB file as each of three turns found it, by its original and what each turn changed, and puts back each", async () => {
      const root = await folders.make("zhiyin-turn-files-large-");
      const storage = await folders.make("zhiyin-turn-files-large-store-");
      // Measured data: noise that compresses little, as a scan does.
      const volume = join(root, "volume.raw");
      const original = await writeNoise(volume, gib);
      const recovery = started(storage);
      const confined = await contained.grant(root);
      const states: string[] = [];
      const pauses: number[] = [];

      for (const [turn, at] of [64 * mib, 512 * mib, 900 * mib].entries()) {
        states.push(await digestOf(volume));
        await recovery.beginTurn("conversation-1", [root]);
        await recovery.copyFolder(`run-${turn + 1}`, root, "conversation-1", {
          begins: true,
        });
        const [patched] = await contained.run(confined, [
          ["patch", volume, String(at)],
        ]);
        pauses.push(patched!.end - patched!.start);
        await recovery.keepFolderChanges(`run-${turn + 1}`);
        await recovery.endTurn("conversation-1");
      }
      const kept = await storeBytes(storage);
      const runs = [1, 2, 3].map((n) => ran(`run-${n}`, n));

      // The original, little compressed, and three edits of a mebibyte each,
      // never three whole copies.
      expect(kept).toBeLessThan(gib + 64 * mib);
      console.info(
        `1 GiB in three turns: store ${(kept / mib).toFixed(0)} MiB; first-write pauses ${pauses.join(", ")} ms`,
      );
      // Going back a message at a time: each goes back past one turn's run.
      for (const from of [3, 2, 1]) {
        const review = await recovery.review(`back-to-${from}`, root, [
          runs[from - 1]!,
        ]);
        const result = await recovery.restore(review);
        expect(result.files).toEqual([
          { path: "volume.raw", status: "restored" },
        ]);
        expect(await digestOf(volume)).toBe(states[from - 1]);
      }
      expect(await digestOf(volume)).toBe(original);
    });

    it("finds a file changed between turns by a program that put its old time back, and keeps it as the next turn found it", async () => {
      const root = await folders.make("zhiyin-turn-files-time-");
      const storage = await folders.make("zhiyin-turn-files-time-store-");
      await writeFile(join(root, "notes.txt"), "the notes as saved");
      const second = new Date("2026-11-01T10:00:00.000Z");
      await utimes(join(root, "notes.txt"), second, second);
      const recovery = started(storage);
      const confined = await contained.grant(root);
      // Saved in a first turn, and left as it is.
      await recovery.beginTurn("conversation-1", [root]);
      expect(await recovery.prepareChange(root, "notes.txt")).toEqual({
        ok: true,
      });
      await recovery.endTurn("conversation-1");
      // Between turns, a program changes it and puts its old time back: to the
      // hundred nanoseconds, as the time is a whole second here.
      const before = await stat(join(root, "notes.txt"), { bigint: true });
      await contained.run(confined, [["keep-time", join(root, "notes.txt")]]);
      const after = await stat(join(root, "notes.txt"), { bigint: true });
      expect([after.size, after.mtimeNs]).toEqual([
        before.size,
        before.mtimeNs,
      ]);
      const between = await readFile(join(root, "notes.txt"));

      await recovery.beginTurn("conversation-1", [root]);
      await recovery.copyFolder("run-2", root, "conversation-1", {
        begins: true,
      });
      await contained.run(confined, [["write", join(root, "notes.txt")]]);
      await recovery.keepFolderChanges("run-2");
      await recovery.endTurn("conversation-1");
      const review = await recovery.review("review", root, [ran("run-2", 1)]);
      await recovery.restore(review);

      expect((await readFile(join(root, "notes.txt"))).equals(between)).toBe(
        true,
      );
    });

    it("keeps the files of a folder outside the workspace the conversation may change as the turn found them, a folder inside it with it", async () => {
      const root = await folders.make("zhiyin-turn-files-own-");
      const elsewhere = await folders.make("zhiyin-turn-files-elsewhere-");
      const storage = await folders.make("zhiyin-turn-files-elsewhere-store-");
      await mkdir(join(elsewhere, "inner"));
      const table = randomBytes(2 * mib);
      const inner = randomBytes(2 * mib);
      await writeFile(join(root, "notes.txt"), "the person's notes");
      await writeFile(join(elsewhere, "table.csv"), table);
      await writeFile(join(elsewhere, "inner", "data.bin"), inner);
      const recovery = started(storage);
      const there = await contained.grant(elsewhere);

      const turn = await recovery.beginTurn("conversation-1", [
        root,
        elsewhere,
        join(elsewhere, "inner"),
        join(elsewhere, "not-there"),
      ]);
      // Written in the turn before the run's copy, as a job of the turn may.
      const early = await contained.run(there, [
        ["write", join(elsewhere, "table.csv")],
        ["write", join(elsewhere, "inner", "data.bin")],
      ]);
      await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });
      await recovery.copyFolder("run-1", elsewhere, "conversation-1", {
        begins: true,
        outside: true,
      });
      await writeFile(join(elsewhere, "table.csv"), "the run's table");
      await writeFile(join(elsewhere, "inner", "data.bin"), "the run's data");
      await recovery.keepFolderChanges("run-1");
      await recovery.endTurn("conversation-1");
      const review = await recovery.review("review", root, [ran("run-1", 0)]);
      await recovery.restore(review);

      expect(turn.folders.map(({ root: folder }) => folder)).toEqual([
        await realpath(root),
        await realpath(elsewhere),
      ]);
      expect(early.map(({ result }) => result)).toEqual(["done", "done"]);
      expect((await readFile(join(elsewhere, "table.csv"))).equals(table)).toBe(
        true,
      );
      expect(
        (await readFile(join(elsewhere, "inner", "data.bin"))).equals(inner),
      ).toBe(true);
    });

    it("keeps the workspace's files as its own when a folder granted for changes holds it", async () => {
      const parent = await folders.make("zhiyin-turn-files-holding-");
      const root = join(parent, "workspace");
      const storage = await folders.make("zhiyin-turn-files-holding-store-");
      await mkdir(root);
      const notes = randomBytes(2 * mib);
      const beside = randomBytes(2 * mib);
      await writeFile(join(root, "notes.txt"), notes);
      await writeFile(join(parent, "beside.txt"), beside);
      const recovery = started(storage);

      const turn = await recovery.beginTurn("conversation-1", [root, parent]);
      // Written in the turn before the run's copy, as a job of the turn may.
      await writeFile(join(root, "notes.txt"), "written meanwhile");
      await writeFile(join(parent, "beside.txt"), "written meanwhile");
      await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });
      await recovery.copyFolder("run-1", parent, "conversation-1", {
        begins: true,
        outside: true,
        without: [root],
      });
      await writeFile(join(root, "notes.txt"), "the run's notes");
      await writeFile(join(parent, "beside.txt"), "the run's");
      const changes = await recovery.keepFolderChanges("run-1");
      await recovery.endTurn("conversation-1");
      const review = await recovery.review("review", root, [ran("run-1", 0)]);
      await recovery.restore(review);

      expect(turn.folders.map(({ root: folder }) => folder)).toEqual([
        await realpath(root),
        await realpath(parent),
      ]);
      // Each change once, the workspace's by its path there.
      expect(changes).toMatchObject({
        status: "checked",
        files: [
          { path: "notes.txt", change: "updated" },
          {
            path: join(await realpath(parent), "beside.txt"),
            change: "updated",
          },
        ],
      });
      expect((await readFile(join(root, "notes.txt"))).equals(notes)).toBe(
        true,
      );
      expect((await readFile(join(parent, "beside.txt"))).equals(beside)).toBe(
        true,
      );
    });

    it("saves each file first for a run that begins after its turn ended, as a specialist's does, and puts it back", async () => {
      const root = await folders.make("zhiyin-turn-files-after-");
      const storage = await folders.make("zhiyin-turn-files-after-store-");
      const notes = randomBytes(4 * mib);
      await writeFile(join(root, "notes.txt"), notes);
      const recovery = started(storage);
      const confined = await contained.grant(root);
      await recovery.beginTurn("conversation-1", [root]);
      await recovery.endTurn("conversation-1");

      await recovery.copyFolder("specialist-run", root, "conversation-1", {
        begins: true,
      });
      const done = await contained.run(confined, [
        ["write", join(root, "notes.txt")],
      ]);
      await recovery.keepFolderChanges("specialist-run");
      const review = await recovery.review("review", root, [
        ran("specialist-run", 0),
      ]);
      await recovery.restore(review);

      expect(done.map(({ result }) => result)).toEqual(["done"]);
      expect((await readFile(join(root, "notes.txt"))).equals(notes)).toBe(
        true,
      );
    });

    it("makes room, when the person agrees, by letting go of a file as it was before its conversation changed it, and says which", async () => {
      const root = await folders.make("zhiyin-turn-files-room-");
      const storage = await folders.make("zhiyin-turn-files-room-store-");
      const old = randomBytes(64 * 1024);
      const big = randomBytes(64 * 1024);
      await writeFile(join(root, "old.tif"), old);
      await writeFile(join(root, "big.tif"), big);
      const asked: string[] = [];
      const released: string[] = [];
      const recovery = new FileRecovery(storage, {
        list,
        watch: sourceWatchThread,
        // Room for one of the two pictures.
        limits: { totalBytes: 100 * 1024 },
        ask: async ({ path }) => {
          asked.push(path);
          return "make-room";
        },
        released: (versions) =>
          released.push(
            ...versions.map(({ actionId, path }) => `${actionId} ${path}`),
          ),
      });
      open.push(recovery);
      const turn = async (n: number, path: string) => {
        await recovery.beginTurn("conversation-1", [root]);
        await recovery.copyFolder(`run-${n}`, root, "conversation-1", {
          begins: true,
        });
        await writeFile(join(root, path), randomBytes(64 * 1024));
        await recovery.keepFolderChanges(`run-${n}`);
        await recovery.endTurn("conversation-1");
      };

      await turn(1, "old.tif");
      await turn(2, "big.tif");

      expect(asked).toEqual(["big.tif"]);
      expect(released).toEqual(["run-1 old.tif"]);
      // What went frees its room.
      const budget = await recovery.undoBudget();
      expect(budget.usedBytes).toBeLessThanOrEqual(budget.budgetBytes);
      const first = await recovery.review("first", root, [ran("run-1", 0)]);
      expect(first.files).toMatchObject([
        { path: "old.tif", status: "unprotected" },
      ]);
      const second = await recovery.review("second", root, [ran("run-2", 1)]);
      await recovery.restore(second);
      expect((await readFile(join(root, "big.tif"))).equals(big)).toBe(true);
    });

    it("with nobody to ask, saves a first write past the budget once what may go has gone, keeping every original", async () => {
      const root = await folders.make("zhiyin-turn-files-past-");
      const storage = await folders.make("zhiyin-turn-files-past-store-");
      const kib = 1024;
      const original = randomBytes(40 * kib);
      const big = randomBytes(130 * kib);
      await writeFile(join(root, "x.bin"), original);
      await writeFile(join(root, "big.bin"), big);
      const released: string[] = [];
      const recovery = new FileRecovery(storage, {
        list,
        watch: sourceWatchThread,
        limits: { totalBytes: 150 * kib },
        released: (versions) =>
          released.push(
            ...versions.map(({ actionId, path }) => `${actionId} ${path}`),
          ),
      });
      open.push(recovery);
      const turn = async (n: number, path: string, size: number) => {
        await recovery.beginTurn("conversation-1", [root]);
        await recovery.copyFolder(`run-${n}`, root, "conversation-1", {
          begins: true,
        });
        await writeFile(join(root, path), randomBytes(size));
        await recovery.keepFolderChanges(`run-${n}`);
        await recovery.endTurn("conversation-1");
      };
      // x.bin as it was, as the second turn found it, and as the third did.
      await turn(1, "x.bin", 40 * kib);
      await turn(2, "x.bin", 40 * kib);
      await turn(3, "x.bin", 40 * kib);

      // No room for big.bin, even with x.bin's later versions gone.
      await turn(4, "big.bin", 130 * kib);

      expect(released).toEqual(["run-2 x.bin", "run-3 x.bin"]);
      const budget = await recovery.undoBudget();
      expect(budget.usedBytes).toBeGreaterThan(budget.budgetBytes);
      await recovery.restore(
        await recovery.review("big", root, [ran("run-4", 3)]),
      );
      expect((await readFile(join(root, "big.bin"))).equals(big)).toBe(true);
      const back = await recovery.review("x", root, [
        ran("run-1", 0),
        ran("run-2", 1),
        ran("run-3", 2),
      ]);
      expect(back.files).toMatchObject([
        { path: "x.bin", status: "recoverable" },
      ]);
      await recovery.restore(back);
      expect((await readFile(join(root, "x.bin"))).equals(original)).toBe(true);
    });

    it("lets Zhiyin's own thread rename a watched file at once, blocking, without waiting on its own watch, and puts it back", async () => {
      const root = await folders.make("zhiyin-turn-files-own-");
      const storage = await folders.make("zhiyin-turn-files-own-store-");
      await writeFile(join(root, "plan.md"), "the plan");
      const recovery = started(storage);

      await recovery.beginTurn("conversation-1", [root]);
      await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });
      // The thread that runs recovery waits on the rename itself: only the
      // watch's own thread can let it go.
      renameSync(join(root, "plan.md"), join(root, "plan-old.md"));
      await recovery.keepFolderChanges("run-1");
      await recovery.endTurn("conversation-1");
      const review = await recovery.review("review", root, [ran("run-1", 0)]);
      await recovery.restore(review);

      expect(await readdir(root)).toEqual(["plan.md"]);
      expect(await readFile(join(root, "plan.md"), "utf8")).toBe("the plan");
    });
  },
);
