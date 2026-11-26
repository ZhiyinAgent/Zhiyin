/**
 * A folder whose hold read-only whole did not end as it should, cut short
 * as a crash would or failed and not undone: it stays written down, and
 * gets its own permissions back at the next start. Tried by a real confined
 * process on a copy of this repository's own `.git`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Walks } from "../src/permission-walks.js";
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
  "a folder whose hold was cut short",
  () => {
    it(
      "gets its own permissions back whole at the next start, what it holds taking from it again",
      { timeout: 120_000 },
      async () => {
        const { work, git, before } = await workspace();
        const data = await folders.make("zhiyin-tree-data-");
        let stopped: () => void = () => undefined;
        let reached: () => void = () => undefined;
        const atCrash = new Promise<void>((resolve) => (reached = resolve));
        // Stopped once its journal is written and the folder kept in place,
        // before its permissions are set by name, as a crash would stop it.
        const holding = heldIn(data, {
          walks: new Walks(),
          beforeTree: () => {
            reached();
            return new Promise<void>((resolve) => (stopped = resolve));
          },
        }).hold(work, [{ path: git, hold: "tree" }]);
        await atCrash;
        const cut = permissions(git);

        await heldIn(data, { walks: new Walks() }).restored;
        const back = new Map(
          [...before.keys()].map((path) => [path, permissions(path)]),
        );
        stopped();
        await (await holding).release();

        expect(cut).not.toBe(before.get(git));
        expect(back).toEqual(before);
      },
    );
  },
);

describe.runIf(process.platform === "win32")(
  "a folder whose hold failed and could not be undone",
  () => {
    it(
      "stays written down, and gets its own permissions back at the next start",
      { timeout: 120_000 },
      async () => {
        const work = await folders.make("zhiyin-tree-work-");
        const records = join(work, "records");
        await mkdir(records);
        await writeFile(join(records, "config"), "settings");
        // The folder given to programs first, as before any run.
        await reach(work, [["read", join(records, "config")]]);
        const before = new Map(
          [records, join(records, "config")].map((path) => [
            path,
            permissions(path),
          ]),
        );
        const data = await folders.make("zhiyin-tree-data-");
        // Windows keeps the folder in place, then refuses to set its
        // permissions by name and to undo that.
        let sets = 0;
        const holds = heldIn(data, {
          walks: new Walks(),
          calls: (real) => ({
            ...real,
            set: (handle, given) =>
              ++sets === 1 ? real.set(handle, given) : "Access is denied.",
            setTree: async () => "Access is denied.",
          }),
        });
        const held = await holds.hold(work, [{ path: records, hold: "tree" }]);
        const left = permissions(records);
        await held.release();

        await heldIn(data, { walks: new Walks() }).restored;
        const back = new Map(
          [...before.keys()].map((path) => [path, permissions(path)]),
        );

        expect(held.failed).toEqual([
          { path: records, reason: "Access is denied." },
        ]);
        expect(left).not.toBe(before.get(records));
        expect(back).toEqual(before);
      },
    );
  },
);
