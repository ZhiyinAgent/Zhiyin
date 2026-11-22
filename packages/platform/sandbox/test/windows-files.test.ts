/**
 * Where an open entry really is, as Windows names it by its handle: what a
 * caller checks a handle against before it trusts what the handle reaches.
 */

import { mkdir, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { windowsFiles } from "../src/index.js";

const folders = new TemporaryFolders();
afterAll(() => folders.removeAll());

const FILE_READ_ATTRIBUTES = 0x80;
const FILE_SHARE_ALL = 0x7;
const OPEN_EXISTING = 3;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;

describe.runIf(process.platform === "win32")(
  "an open entry's real place",
  () => {
    it("is the folder itself, or, opened through a junction, where the junction leads", async () => {
      const root = await folders.make("zhiyin-final-path-");
      const elsewhere = await folders.make("zhiyin-final-path-elsewhere-");
      await mkdir(join(elsewhere, "inner"));
      await symlink(elsewhere, join(root, "door"), "junction");
      const windows = windowsFiles();
      const placeOf = (path: string) => {
        const opening = windows.open(
          path,
          FILE_READ_ATTRIBUTES,
          FILE_SHARE_ALL,
          OPEN_EXISTING,
          FILE_FLAG_BACKUP_SEMANTICS,
        );
        if (!opening.handle) throw new Error(`Not opened: ${path}`);
        try {
          return windows.finalPath(opening.handle);
        } finally {
          windows.close(opening.handle);
        }
      };

      expect(placeOf(root)?.toLowerCase()).toBe(
        (await realpath(root)).toLowerCase(),
      );
      expect(placeOf(join(root, "door", "inner"))?.toLowerCase()).toBe(
        join(await realpath(elsewhere), "inner").toLowerCase(),
      );
    });
  },
);
