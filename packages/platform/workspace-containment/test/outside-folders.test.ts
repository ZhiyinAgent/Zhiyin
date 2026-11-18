/**
 * The folders outside the workspace a program asks to change too: each named
 * by its whole real path, there, and reached through no link; never Zhiyin's
 * own, nor one so wide it holds nearly everything.
 */

import { mkdir, realpath, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { outsideFolders } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function places() {
  const root = await realpath(await folders.make("zhiyin-outside-root-"));
  const elsewhere = await realpath(
    await folders.make("zhiyin-outside-elsewhere-"),
  );
  const own = await realpath(await folders.make("zhiyin-outside-own-"));
  return { root, elsewhere, own };
}

describe("folders outside the workspace", () => {
  it("gives nothing when none is asked for", async () => {
    const { root } = await places();

    expect(await outsideFolders(undefined, root, [])).toEqual({
      ok: true,
      folders: [],
    });
  });

  it("gives each folder by its real path, once, and takes one inside the workspace as the workspace's", async () => {
    const { root, elsewhere } = await places();
    await mkdir(join(root, "renders"));

    expect(
      await outsideFolders(
        [elsewhere, elsewhere.toUpperCase(), join(root, "renders")],
        root,
        [],
      ),
    ).toEqual({ ok: true, folders: [elsewhere] });
  });

  it("refuses a relative path, a folder that is not there, a list that is not one, and a folder reached through a link", async () => {
    const { root, elsewhere } = await places();
    const link = join(root, "..", `${parse(elsewhere).base}-link`);
    await symlink(elsewhere, link, "junction");

    for (const asked of [
      ["renders"],
      [join(elsewhere, "missing")],
      "D:\\renders",
      [link],
    ])
      expect(await outsideFolders(asked, root, [])).toMatchObject({
        ok: false,
      });
    expect(await outsideFolders([link], root, [])).toMatchObject({
      reason: expect.stringContaining(elsewhere),
    });
  });

  it("refuses Zhiyin's own folders, one inside them and one holding them", async () => {
    const { root, own } = await places();
    await mkdir(join(own, "inside"));
    // A name that starts with two dots is still a folder inside.
    await mkdir(join(own, "..cache"));

    for (const asked of [
      own,
      join(own, "inside"),
      join(own, "..cache"),
      join(own, ".."),
    ])
      expect(await outsideFolders([asked], root, [own])).toMatchObject({
        ok: false,
      });
  });

  it("refuses a drive, the person's user folder and a folder holding it", async () => {
    const { root } = await places();
    const home = homedir();

    for (const asked of [parse(home).root, home, join(home, "..")])
      expect(await outsideFolders([asked], root, [])).toMatchObject({
        ok: false,
        reason: expect.stringContaining("holds nearly everything"),
      });
  });
});
