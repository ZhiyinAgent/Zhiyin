/**
 * A folder swapped for a junction while recovery works in it (ADR 0031): a
 * thread of its own swaps a folder of the workspace for a junction to a
 * folder outside and back, as fast as it can, while files there are saved
 * and put back. Whatever moment the swap lands on, nothing outside is read
 * into the store, and nothing outside is written, made or removed.
 */

import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sourceWatchThread } from "@zhiyin/file-watch";
import { runProcess } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { bundledRipgrep, listFiles } from "@zhiyin/workspace-listing";
import type { ListWorkspace, TaskAction } from "@zhiyin/contract";
import { FileRecovery } from "../src/index.js";

const folders = new TemporaryFolders();
const open: FileRecovery[] = [];
afterEach(async () => {
  for (const recovery of open.splice(0)) await recovery.close();
});
afterAll(() => folders.removeAll());

const mib = 1024 * 1024;

/** Every file of a folder as the app lists them for keeping, links as links. */
const list: ListWorkspace = (root, part) =>
  listFiles(
    {
      search: { rg: bundledRipgrep()!, run: runProcess },
      upTo: 20_000,
      kept: 200,
    },
    root,
    { ignored: true, all: true, ...(part ? { part } : {}) },
  );

function started(storage: string, watched: boolean) {
  const recovery = new FileRecovery(storage, {
    list,
    ...(watched ? { watch: sourceWatchThread } : {}),
    limits: { totalBytes: 1024 * mib },
  });
  open.push(recovery);
  return recovery;
}

const ran = (id: string): TaskAction => ({
  id,
  action: "Run a Python script",
  target: "a script",
  status: "completed",
  sequence: 0,
});

/** What the store of versions takes on disk, every file of it. */
async function storeBytes(storage: string): Promise<number> {
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

/**
 * Swaps `folder` for a junction to `outside` and back, on a thread of its
 * own, until stopped: each round moves the folder aside, puts the junction
 * in its place for a moment, takes it away and moves the folder back. A
 * step another opener blocks is let be, and tried again next round.
 */
function swapping(folder: string, outside: string) {
  const shared = new SharedArrayBuffer(8);
  const state = new Int32Array(shared);
  const worker = new Worker(
    `
    const { workerData } = require("node:worker_threads");
    const fs = require("node:fs");
    const { folder, outside, shared } = workerData;
    const state = new Int32Array(shared);
    const aside = folder + ".aside";
    // A fifth of a millisecond, waited out on the spot: Windows' timers are
    // far coarser.
    const sleep = () => {
      const until = process.hrtime.bigint() + 200000n;
      while (process.hrtime.bigint() < until);
    };
    let made = 0;
    // Puts the folder back from aside. A folder made meanwhile in the empty
    // place, as a restore makes one for a file it puts back, is moved away
    // first; a step another opener blocks is tried again.
    const putBack = () => {
      try { fs.renameSync(aside, folder); return true; }
      catch {
        try { if (!fs.lstatSync(folder).isSymbolicLink()) fs.renameSync(folder, folder + ".made-" + made++); }
        catch {}
        sleep();
        return false;
      }
    };
    while (Atomics.load(state, 0) === 0) {
      if (fs.existsSync(aside)) { putBack(); continue; }
      try { fs.renameSync(folder, aside); } catch { sleep(); continue; }
      try { fs.symlinkSync(outside, folder, "junction"); sleep(); } catch {}
      for (;;) {
        try { if (fs.lstatSync(folder).isSymbolicLink()) fs.rmdirSync(folder); break; }
        catch (error) { if (error.code === "ENOENT") break; }
      }
      while (!putBack() && Atomics.load(state, 0) === 0);
      Atomics.add(state, 1, 1);
      sleep();
    }
    // Left as it was found: the folder in its place.
    for (let tries = 0; tries < 100 && fs.existsSync(aside); tries += 1) putBack();
    `,
    { eval: true, workerData: { folder, outside, shared } },
  );
  return {
    /** Stops the swapping, and answers how many rounds it made. */
    async stop(): Promise<number> {
      Atomics.store(state, 0, 1);
      await new Promise((settle) => worker.once("exit", settle));
      return Atomics.load(state, 1);
    },
  };
}

/** Every entry of a folder, with what each file holds. */
async function contents(folder: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const name of (await readdir(folder)).sort())
    found[name] = await readFile(join(folder, name), "utf8");
  return found;
}

describe.runIf(process.platform === "win32")(
  "a folder swapped for a junction while recovery works in it",
  { timeout: 300_000 },
  () => {
    it("never reads a file outside into the store, however the swaps land on the saves", async () => {
      const root = await folders.make("zhiyin-race-save-");
      const outside = await folders.make("zhiyin-race-save-outside-");
      const storage = await folders.make("zhiyin-race-save-store-");
      await mkdir(join(root, "data"));
      await writeFile(join(root, "notes.txt"), "the notes");
      await writeFile(join(root, "data", "table.bin"), "the table");
      // Four mebibytes of noise outside, by the same name as the file inside.
      await writeFile(join(outside, "table.bin"), randomBytes(4 * mib));
      const unwatched = started(storage, false);
      const watched = started(storage, true);

      const swaps = swapping(join(root, "data"), outside);
      const saves = 100;
      for (let round = 0; round < saves; round += 1) {
        await unwatched.copyFolder(`run-${round}`, root, "conversation-1", {
          begins: true,
        });
        await watched.beginTurn(`conversation-${round}`, [root]);
        await watched.endTurn(`conversation-${round}`);
      }
      const rounds = await swaps.stop();

      console.info(`${rounds} swaps over ${saves} rounds of saves`);
      expect(rounds).toBeGreaterThan(0);
      expect(await storeBytes(storage)).toBeLessThan(mib);
    });

    it("never writes, makes or removes a file outside, however the swaps land on the restores", async () => {
      const root = await folders.make("zhiyin-race-restore-");
      const outside = await folders.make("zhiyin-race-restore-outside-");
      const storage = await folders.make("zhiyin-race-restore-store-");
      const data = join(root, "data");
      const count = 150;
      const numbers = Array.from({ length: count }, (_, at) => at);
      await mkdir(data);
      for (const at of numbers) {
        await writeFile(join(data, `changed-${at}.txt`), `as it was ${at}`);
        await writeFile(join(data, `deleted-${at}.txt`), `deleted ${at}`);
        // The same names outside, which a write through a junction would reach.
        await writeFile(join(outside, `changed-${at}.txt`), `outside ${at}`);
        await writeFile(join(outside, `made-${at}.txt`), `outside made ${at}`);
      }
      const before = await contents(outside);
      const recovery = started(storage, false);
      await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });
      for (const at of numbers) {
        await writeFile(join(data, `changed-${at}.txt`), `changed ${at}`);
        await rm(join(data, `deleted-${at}.txt`));
        await writeFile(join(data, `made-${at}.txt`), `made ${at}`);
      }
      await recovery.keepFolderChanges("run-1");
      const review = await recovery.review("review", root, [ran("run-1")]);

      const swaps = swapping(data, outside);
      const result = await recovery.restore(review);
      const rounds = await swaps.stop();

      const statuses = new Map<string, number>();
      for (const file of result.files)
        statuses.set(file.status, (statuses.get(file.status) ?? 0) + 1);
      console.info(
        `${rounds} swaps over ${result.files.length} files: ${[...statuses].map(([status, files]) => `${files} ${status}`).join(", ")}`,
      );
      expect(rounds).toBeGreaterThan(0);
      // Each file is put back or left as a conflict, and none outside is
      // written, made or removed.
      expect(await contents(outside)).toEqual(before);
      expect(statuses.get("unprotected") ?? 0).toBe(0);
    });
  },
);
