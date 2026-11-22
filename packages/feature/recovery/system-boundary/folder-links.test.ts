/**
 * The links anywhere in a folder, as git run for a sealed-off shell asks for
 * them: every folder walked, `.git` and `node_modules` too, and kept from the
 * real change journal, with real junctions.
 */

import { mkdir, rmdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { folderLinks } from "../src/index.js";

const folders = new TemporaryFolders();
afterAll(() => folders.removeAll());

describe.runIf(process.platform === "win32")("the links in a folder", () => {
  it("names each junction, in .git and node_modules too, and those made or removed since it was last asked", async () => {
    const root = await folders.make("zhiyin-folder-links-");
    const outside = await folders.make("zhiyin-folder-links-outside-");
    await mkdir(join(root, ".git", "hooks"), { recursive: true });
    await mkdir(join(root, "node_modules", "package"), { recursive: true });
    await symlink(outside, join(root, ".git", "hooks", "door"), "junction");
    await symlink(
      outside,
      join(root, "node_modules", "package", "door"),
      "junction",
    );
    await symlink(outside, join(root, "door"), "junction");
    const linksIn = folderLinks();
    const sorted = async () =>
      (await linksIn(root))
        ?.map(({ path, target }) => [path, target])
        .sort(([one], [other]) => one!.localeCompare(other!));

    const first = await sorted();
    await rmdir(join(root, "door"));
    await mkdir(join(root, "deeper"));
    await symlink(outside, join(root, "deeper", "door"), "junction");
    const after = await sorted();

    expect(first).toEqual([
      [join(root, ".git", "hooks", "door"), outside],
      [join(root, "door"), outside],
      [join(root, "node_modules", "package", "door"), outside],
    ]);
    expect(after).toEqual([
      [join(root, ".git", "hooks", "door"), outside],
      [join(root, "deeper", "door"), outside],
      [join(root, "node_modules", "package", "door"), outside],
    ]);
  });

  it("cannot say for a folder that is not there", async () => {
    const root = await folders.make("zhiyin-folder-links-gone-");

    expect(await folderLinks()(join(root, "missing"))).toBeUndefined();
  });
});
