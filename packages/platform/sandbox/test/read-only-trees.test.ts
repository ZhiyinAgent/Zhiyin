/**
 * A folder held read-only whole, as Git's folder is for a sealed-off script:
 * tried by a real confined process on a copy of this repository's own `.git`,
 * which is never itself touched. Everything in it is read and nothing of it
 * changed; once let go, and at the next start when Zhiyin stopped holding it,
 * every permission is exactly as it was.
 */

import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  folders,
  heldIn,
  letGo,
  object,
  permissions,
  placePrograms,
  reach,
  ref,
  removePrograms,
  repositoryGit,
  workspace,
} from "./held-trees.js";

afterEach(letGo);
afterAll(removePrograms);

let isFolder = false;
beforeAll(async () => {
  await placePrograms();
  isFolder = (await stat(repositoryGit).catch(() => undefined))?.isDirectory()
    ? true
    : false;
});

describe.runIf(process.platform === "win32")("a folder held whole", () => {
  it(
    "is read by a sealed-off program, which can neither delete, overwrite nor rename an object or a ref, nor add a file anywhere in it",
    { timeout: 120_000 },
    async () => {
      const { work, git, entries } = await workspace();
      const holds = heldIn(await folders.make("zhiyin-tree-data-"));

      let started = performance.now();
      const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);
      const holding = performance.now() - started;
      const results = await reach(work, [
        ["read", ref(git)],
        ["list", join(git, "objects", "zz")],
        ["delete", object(git)],
        ["write", object(git)],
        ["rename", ref(git), join(git, "refs", "heads", "moved")],
        ["delete", ref(git)],
        ["write", join(git, "objects", "zz", "new")],
        ["write", join(git, "new-file")],
        ["mkdir", join(git, "hooks-made")],
        ["rename", git, join(work, "moved-git")],
        ["write", join(work, "beside.txt")],
      ]);
      started = performance.now();
      await hold.release();
      const releasing = performance.now() - started;
      console.log(
        `Held ${entries.length} entries of .git in ${Math.round(holding)} ms, let go in ${Math.round(releasing)} ms.`,
      );

      expect(hold.failed).toEqual([]);
      expect(results).toEqual([
        "0".repeat(40),
        "object",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "EPERM",
        "done",
      ]);
    },
  );

  it(
    "gets back exactly the permissions it and what it holds had, and is all writable again",
    { timeout: 120_000 },
    async () => {
      const { work, git, before } = await workspace();
      const holds = heldIn(await folders.make("zhiyin-tree-data-"));

      const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);
      await hold.release();
      const results = await reach(work, [
        ["delete", object(git)],
        ["write", join(git, "new-file")],
        ["append", ref(git)],
      ]);

      expect(
        new Map([...before.keys()].map((path) => [path, permissions(path)])),
      ).toEqual(before);
      expect(results).toEqual(["done", "done", "done"]);
    },
  );

  it(
    "holds by itself an entry in it with permissions of its own",
    { timeout: 120_000 },
    async () => {
      const { work, git } = await workspace();
      // Its entries made its own, the workspace's grant among them.
      execFileSync("icacls", [ref(git), "/inheritance:d"], { stdio: "ignore" });
      const holds = heldIn(await folders.make("zhiyin-tree-data-"));
      const before = permissions(ref(git));

      const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);
      const results = await reach(work, [
        ["read", ref(git)],
        ["append", ref(git)],
      ]);
      await hold.release();

      expect(results).toEqual(["0".repeat(40), "EPERM"]);
      expect(permissions(ref(git))).toBe(before);
    },
  );

  it(
    "gets its permissions back at the next start when Zhiyin stopped while holding it",
    { timeout: 120_000 },
    async () => {
      const { work, git, before } = await workspace();
      const data = await folders.make("zhiyin-tree-data-");
      await heldIn(data).hold(work, [{ path: git, hold: "tree" }]);

      await heldIn(data).restored;

      expect(
        new Map([...before.keys()].map((path) => [path, permissions(path)])),
      ).toEqual(before);
      expect(await reach(work, [["delete", object(git)]])).toEqual(["done"]);
    },
  );
});

describe.runIf(process.platform === "win32")("this test", () => {
  it("has this repository's `.git` folder to copy", () => {
    expect(isFolder).toBe(true);
  });
});
