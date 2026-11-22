/**
 * Junctions and symbolic links in a folder whose files a turn or a run keeps
 * (ADR 0031). A program may make a link pointing anywhere, and recovery acts
 * with the person's rights, so a link is recorded and put back as a link and
 * never followed: what it leads to is never read, saved, watched or written.
 * Real junctions, made without administrator rights, and symbolic links where
 * the account may make them; the app's own listing.
 */

import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  rmdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sourceWatchThread } from "@zhiyin/file-watch";
import { runProcess } from "@zhiyin/sandbox";
import { Contained } from "@zhiyin/sandbox/testing";
import { TemporaryFolders } from "@zhiyin/test-support";
import { bundledRipgrep, listFiles } from "@zhiyin/workspace-listing";
import type { ListWorkspace, TaskAction } from "@zhiyin/contract";
import { FileRecovery } from "../src/index.js";

const folders = new TemporaryFolders();
const contained = new Contained(folders);
const open: FileRecovery[] = [];
afterEach(async () => {
  for (const recovery of open.splice(0)) await recovery.close();
});
afterAll(async () => {
  contained.forget();
  await folders.removeAll();
});

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

/** Whether this account may make a symbolic link: Developer Mode or an administrator. */
async function maySymlink(): Promise<boolean> {
  const probe = await folders.make("zhiyin-links-probe-");
  return symlink(join(probe, "nowhere"), join(probe, "link"), "file").then(
    () => true,
    () => false,
  );
}

describe.runIf(process.platform === "win32")(
  "a junction or symbolic link in a kept folder",
  { timeout: 300_000 },
  () => {
    it("is never followed by a turn: nothing it leads to is saved or watched, and a write there waits for nothing", async () => {
      const root = await folders.make("zhiyin-links-turn-");
      const outside = await folders.make("zhiyin-links-outside-");
      const storage = await folders.make("zhiyin-links-turn-store-");
      await writeFile(join(root, "notes.txt"), "the notes");
      const secret = randomBytes(4 * mib);
      await writeFile(join(outside, "secret.bin"), secret);
      await symlink(outside, join(root, "elsewhere"), "junction");
      if (await maySymlink())
        await symlink(
          join(outside, "secret.bin"),
          join(root, "key.bin"),
          "file",
        );
      const recovery = started(storage, true);
      const confined = await contained.grant(root);

      const turn = await recovery.beginTurn("conversation-1", [root]);
      const copy = await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });
      // What the links lead to is written meanwhile, from outside any run.
      await writeFile(join(outside, "secret.bin"), "changed outside");
      await contained.run(confined, [["write", join(root, "notes.txt")]]);
      const changes = await recovery.keepFolderChanges("run-1");
      await recovery.endTurn("conversation-1");

      expect(turn.folders[0]?.copy).toEqual({ ok: true, uncopied: [] });
      expect(copy).toEqual({ ok: true, uncopied: [] });
      // Four mebibytes of noise were never read into the store.
      expect(await storeBytes(storage)).toBeLessThan(mib);
      expect(changes).toEqual({
        status: "checked",
        files: [{ path: "notes.txt", change: "updated", kept: true }],
      });
      expect(await readlink(join(root, "elsewhere"))).toBe(outside);
    });

    it("is recorded and put back as a link: one removed is made again, one made is removed, and what each leads to is left alone", async () => {
      const root = await folders.make("zhiyin-links-run-");
      const first = await folders.make("zhiyin-links-first-");
      const second = await folders.make("zhiyin-links-second-");
      const storage = await folders.make("zhiyin-links-run-store-");
      await writeFile(join(first, "kept.txt"), "in the first folder");
      await writeFile(join(second, "kept.txt"), "in the second folder");
      await writeFile(join(root, "notes.txt"), "the notes");
      await symlink(first, join(root, "door"), "junction");
      const symbolic = await maySymlink();
      const recovery = started(storage, false);
      await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });

      // The run takes one link away and makes others.
      await rmdir(join(root, "door"));
      await symlink(second, join(root, "made"), "junction");
      if (symbolic)
        await symlink(join(first, "kept.txt"), join(root, "key.txt"), "file");
      const changes = await recovery.keepFolderChanges("run-1");
      const review = await recovery.review("review", root, [ran("run-1")]);
      const result = await recovery.restore(review);

      expect(changes).toEqual({
        status: "checked",
        files: [
          { path: "door", change: "deleted", kept: true },
          ...(symbolic ? [{ path: "key.txt", change: "created" }] : []),
          { path: "made", change: "created" },
        ],
      });
      expect(result.files).toEqual(
        expect.arrayContaining([
          { path: "door", status: "restored" },
          { path: "made", status: "removed" },
          ...(symbolic ? [{ path: "key.txt", status: "removed" }] : []),
        ]),
      );
      expect(await readlink(join(root, "door"))).toBe(first);
      expect((await readdir(root)).sort()).toEqual(["door", "notes.txt"]);
      expect(await readFile(join(first, "kept.txt"), "utf8")).toBe(
        "in the first folder",
      );
      expect(await readFile(join(second, "kept.txt"), "utf8")).toBe(
        "in the second folder",
      );
    });

    it("is swapped back: a file a run replaced with a junction gets its bytes back, and a junction it replaced with a file is made again", async () => {
      const root = await folders.make("zhiyin-links-place-");
      const elsewhere = await folders.make("zhiyin-links-place-elsewhere-");
      const storage = await folders.make("zhiyin-links-place-store-");
      await writeFile(join(elsewhere, "kept.txt"), "left alone");
      await writeFile(join(root, "settings"), "the settings as they were");
      await symlink(elsewhere, join(root, "shared"), "junction");
      const recovery = started(storage, false);
      await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });

      await rm(join(root, "settings"));
      await symlink(elsewhere, join(root, "settings"), "junction");
      await rmdir(join(root, "shared"));
      await writeFile(join(root, "shared"), "a file in the link's place");
      const changes = await recovery.keepFolderChanges("run-1");
      const review = await recovery.review("review", root, [ran("run-1")]);
      const result = await recovery.restore(review);

      expect(changes).toEqual({
        status: "checked",
        files: [
          { path: "settings", change: "updated", kept: true },
          { path: "shared", change: "updated", kept: true },
        ],
      });
      expect(result.files).toEqual(
        expect.arrayContaining([
          { path: "settings", status: "restored" },
          { path: "shared", status: "restored" },
        ]),
      );
      expect(await readFile(join(root, "settings"), "utf8")).toBe(
        "the settings as they were",
      );
      expect(await readlink(join(root, "shared"))).toBe(elsewhere);
      expect(await readdir(elsewhere)).toEqual(["kept.txt"]);
      expect(await readFile(join(elsewhere, "kept.txt"), "utf8")).toBe(
        "left alone",
      );
    });

    it("refuses, as a conflict, to put back a file whose folder was replaced by a junction leading outside, and writes nothing there", async () => {
      const root = await folders.make("zhiyin-links-swap-");
      const ssh = await folders.make("zhiyin-links-ssh-");
      const storage = await folders.make("zhiyin-links-swap-store-");
      await mkdir(join(root, "data"));
      await writeFile(join(root, "data", "id_ed25519"), "the notes as saved");
      await writeFile(join(ssh, "id_ed25519"), "the person's key");
      const recovery = started(storage, false);
      await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });
      await writeFile(join(root, "data", "id_ed25519"), "changed by the run");
      await recovery.keepFolderChanges("run-1");

      // After it was saved, the folder becomes a junction to the person's keys.
      await rm(join(root, "data"), { recursive: true });
      await symlink(ssh, join(root, "data"), "junction");
      const review = await recovery.review("review", root, [ran("run-1")]);
      const result = await recovery.restore(review);

      expect(review.files).toEqual([
        {
          path: "data/id_ed25519",
          action: "restore",
          status: "conflict",
          reason:
            "A folder on the way to this file is now a junction or a symbolic link, which may lead outside the folder, so nothing was read or written there.",
        },
      ]);
      expect(result.files.map(({ path, status }) => [path, status])).toEqual([
        ["data/id_ed25519", "conflict"],
      ]);
      expect(await readFile(join(ssh, "id_ed25519"), "utf8")).toBe(
        "the person's key",
      );
      expect(await readdir(ssh)).toEqual(["id_ed25519"]);
    });

    it("refuses a restore whose folder became a junction after the review, and writes nothing there", async () => {
      const root = await folders.make("zhiyin-links-late-");
      const ssh = await folders.make("zhiyin-links-late-ssh-");
      const storage = await folders.make("zhiyin-links-late-store-");
      await mkdir(join(root, "data"));
      await writeFile(join(root, "data", "id_ed25519"), "the notes as saved");
      const recovery = started(storage, false);
      await recovery.copyFolder("run-1", root, "conversation-1", {
        begins: true,
      });
      await writeFile(join(root, "data", "id_ed25519"), "changed by the run");
      await recovery.keepFolderChanges("run-1");
      const review = await recovery.review("review", root, [ran("run-1")]);

      // Between the review and going back, the folder becomes a junction to
      // a folder holding a file with the very contents the run left.
      await writeFile(join(ssh, "id_ed25519"), "changed by the run");
      await rm(join(root, "data"), { recursive: true });
      await symlink(ssh, join(root, "data"), "junction");
      const result = await recovery.restore(review);

      expect(review.files.map(({ status }) => status)).toEqual(["recoverable"]);
      expect(result.files).toEqual([
        {
          path: "data/id_ed25519",
          status: "conflict",
          reason:
            "A folder on the way to this file is now a junction or a symbolic link, which may lead outside the folder, so nothing was read or written there.",
        },
      ]);
      expect(await readFile(join(ssh, "id_ed25519"), "utf8")).toBe(
        "changed by the run",
      );
      expect(await readdir(ssh)).toEqual(["id_ed25519"]);
    });
  },
);
