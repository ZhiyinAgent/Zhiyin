/**
 * A folder held read-only whole stays where it is: a sealed-off program
 * cannot move it away, it is not held where apps may, and letting it go
 * gives permissions back to that same folder alone. Tried by a real confined
 * process on a copy of this repository's own `.git`.
 */

import { execFileSync } from "node:child_process";
import { rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  folders,
  heldIn,
  letGo,
  permissions,
  placePrograms,
  reach,
  removePrograms,
  workspace,
} from "./held-trees.js";

afterEach(letGo);
afterAll(removePrograms);
beforeAll(placePrograms);

describe.runIf(process.platform === "win32")(
  "a folder held whole in place",
  () => {
    it(
      "cannot be moved away by a sealed-off program, by its own name or through the folder it is in",
      { timeout: 120_000 },
      async () => {
        const { work, git } = await workspace();
        const holds = heldIn(await folders.make("zhiyin-tree-data-"));
        const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);

        // Moving a folder needs its own right to be deleted, or its parent's
        // right to remove what it holds; the workspace's grant gives neither.
        const results = await reach(work, [
          ["rename", git, join(work, "moved-git")],
          ["mkdir", join(work, "other")],
          ["rename", join(work, "other"), join(work, "other-moved")],
        ]);
        await hold.release();

        expect(results).toEqual(["EPERM", "done", "done"]);
      },
    );

    it(
      "is not held where apps may remove what the folder it is in holds, and keeps its permissions",
      { timeout: 120_000 },
      async () => {
        const { work, git, before } = await workspace();
        // Every app given the right to remove anything in the workspace.
        execFileSync("icacls", [work, "/grant", "*S-1-15-2-1:(DC)"], {
          stdio: "ignore",
        });
        const holds = heldIn(await folders.make("zhiyin-tree-data-"));

        const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);

        expect(hold.held).toEqual([]);
        expect(hold.failed).toEqual([
          {
            path: git,
            reason: expect.stringContaining("cannot keep it in place"),
          },
        ]);
        expect(permissions(git)).toBe(before.get(git));
      },
    );

    it(
      "gets its permissions back only on the same folder, never on what a link put under its name leads to",
      { timeout: 120_000 },
      async () => {
        const { work, git } = await workspace();
        const elsewhere = await folders.make("zhiyin-tree-elsewhere-");
        const elsewhereBefore = permissions(elsewhere);
        const holds = heldIn(await folders.make("zhiyin-tree-data-"));
        const hold = await holds.hold(work, [{ path: git, hold: "tree" }]);

        // The person moves the folder away and leaves a junction in its place.
        await rename(git, join(work, "moved-git"));
        await symlink(elsewhere, git, "junction");
        await hold.release();

        expect(permissions(elsewhere)).toBe(elsewhereBefore);
      },
    );
  },
);
