/**
 * A folder's files as the bundled ripgrep lists them, and two listings
 * compared. Real ripgrep and real files, because what ripgrep chooses is what
 * is being shown.
 */

import { mkdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProcess } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { bundledRipgrep, compareListings, listFiles } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const setup = (upTo = 1_000) => ({
  search: { rg: bundledRipgrep()!, run: runProcess },
  upTo,
  kept: 200,
});

async function folderWith(files: Record<string, string>): Promise<string> {
  const root = await folders.make("zhiyin-listing-");
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

function namesIn(listing: Awaited<ReturnType<typeof listFiles>>): string[] {
  if (!listing.ok) throw new Error(listing.reason);
  return [...listing.files.keys()].sort();
}

describe("listing a folder's files", () => {
  const files = {
    "notes.md": "notes",
    ".env": "hidden",
    ".gitignore": "data.csv\n",
    "data.csv": "1,2",
    "node_modules/pkg/index.js": "module",
    ".git/HEAD": "ref",
  };

  it("lists hidden files, and leaves out Git's folder, rebuilt folders and what .gitignore lists", async () => {
    const root = await folderWith(files);

    expect(namesIn(await listFiles(setup(), root))).toEqual([
      ".env",
      ".gitignore",
      "notes.md",
    ]);
  });

  it("lists what .gitignore lists when asked to, still leaving out Git's folder and rebuilt folders", async () => {
    const root = await folderWith(files);

    expect(namesIn(await listFiles(setup(), root, { ignored: true }))).toEqual([
      ".env",
      ".gitignore",
      "data.csv",
      "notes.md",
    ]);
  });

  it("gives each file's size", async () => {
    const root = await folderWith({ "notes.md": "five!" });

    const listing = await listFiles(setup(), root);

    expect(listing.ok && listing.files.get("notes.md")?.size).toBe(5);
  });

  it("gives each file's identity on its volume, which stays with it when it is renamed", async () => {
    const root = await folderWith({ "notes.md": "notes", "plan.md": "plan" });
    const before = await listFiles(setup(), root);
    await rename(join(root, "notes.md"), join(root, "renamed.md"));
    const after = await listFiles(setup(), root);

    if (!before.ok || !after.ok) throw new Error("Not listed.");
    expect(before.files.get("notes.md")?.id).toBe(
      String((await stat(join(root, "renamed.md"), { bigint: true })).ino),
    );
    expect(after.files.get("renamed.md")?.id).toBe(
      before.files.get("notes.md")?.id,
    );
    expect(before.files.get("plan.md")?.id).not.toBe(
      before.files.get("notes.md")?.id,
    );
  });

  it("refuses a folder holding more files than it may list, saying so", async () => {
    const root = await folderWith({ a: "", b: "", c: "" });

    expect(await listFiles(setup(2), root)).toEqual({
      ok: false,
      reason:
        "This folder has more than 2 files, too many to check what commands change.",
    });
  });

  it("lists every file, past its bound, when all are asked for", async () => {
    const root = await folderWith({ a: "1", b: "22", c: "333" });

    const listing = await listFiles(setup(2), root, { all: true });

    expect(namesIn(listing)).toEqual(["a", "b", "c"]);
    expect(listing.ok && listing.files.get("c")?.size).toBe(3);
  });

  it("lists a junction or symbolic link as itself when all are asked for, never what it leads to", async () => {
    const root = await folderWith({
      ...files,
      "sub/x.txt": "x",
      "empty/.keep": "",
    });
    const outside = await folderWith({ "secret.txt": "the person's key" });
    await symlink(outside, join(root, "elsewhere"), "junction");
    // A symbolic link needs Developer Mode or an administrator.
    const symbolic = await symlink(
      join(outside, "secret.txt"),
      join(root, "key.txt"),
      "file",
    ).then(
      () => true,
      () => false,
    );

    const listing = await listFiles(setup(), root, { all: true });

    if (!listing.ok) throw new Error(listing.reason);
    expect([...listing.files.keys()].sort()).toEqual(
      [
        ".env",
        ".gitignore",
        "data.csv",
        "elsewhere",
        "empty/.keep",
        ...(symbolic ? ["key.txt"] : []),
        "notes.md",
        "sub/x.txt",
      ].sort(),
    );
    expect(listing.files.get("elsewhere")?.link).toBe(`junction ${outside}`);
    if (symbolic)
      expect(listing.files.get("key.txt")?.link).toBe(
        `file ${join(outside, "secret.txt")}`,
      );
    expect([...(listing.folders?.keys() ?? [])].sort()).toEqual([
      "",
      "empty",
      "sub",
    ]);
    expect(listing.folders?.get("sub")).toBe(
      String((await stat(join(root, "sub"), { bigint: true })).ino),
    );
  });

  it("lists only the entries asked for, those of the folders asked for, or all of a folder", async () => {
    const root = await folderWith({
      "top.txt": "t",
      "else.txt": "e",
      "sub/x.txt": "x",
      "sub/deeper/y.txt": "y",
      "other/z.txt": "z",
    });

    const listing = await listFiles(setup(), root, {
      all: true,
      part: {
        entries: ["top.txt", "gone.txt"],
        entriesOf: ["sub"],
        wholeOf: ["other"],
      },
    });

    expect(namesIn(listing)).toEqual(["other/z.txt", "sub/x.txt", "top.txt"]);
    expect(
      [...(listing.ok ? (listing.folders?.keys() ?? []) : [])].sort(),
    ).toEqual(["other", "sub/deeper"]);
  });

  it("refuses to list part of a folder through a junction", async () => {
    const root = await folderWith({ "notes.md": "n" });
    const outside = await folderWith({ "secret.txt": "the person's key" });
    await symlink(outside, join(root, "elsewhere"), "junction");

    for (const part of [
      { entries: ["elsewhere/secret.txt"], entriesOf: [], wholeOf: [] },
      { entries: [], entriesOf: ["elsewhere"], wholeOf: [] },
      { entries: [], entriesOf: [], wholeOf: ["elsewhere"] },
    ])
      expect((await listFiles(setup(), root, { all: true, part })).ok).toBe(
        false,
      );
  });

  it("lists nothing without ripgrep", async () => {
    const root = await folderWith({ a: "" });

    expect(
      await listFiles({ search: undefined, upTo: 10, kept: 10 }, root),
    ).toEqual({
      ok: false,
      reason: "Zhiyin could not list this folder's files.",
    });
  });
});

describe("comparing two listings", () => {
  it("names the files created, changed and removed, by size and time", async () => {
    const root = await folderWith({ kept: "same", grown: "a", gone: "x" });
    const before = await listFiles(setup(), root);
    await writeFile(join(root, "grown"), "a longer text");
    await writeFile(join(root, "made"), "new");
    await rm(join(root, "gone"));

    expect(compareListings(before, await listFiles(setup(), root), 10)).toEqual(
      {
        status: "checked",
        files: [
          { path: "gone", change: "deleted" },
          { path: "grown", change: "updated" },
          { path: "made", change: "created" },
        ],
      },
    );
  });

  it("names the first files and counts the rest", async () => {
    const root = await folderWith({});
    const before = await listFiles(setup(), root);
    for (const name of ["a", "b", "c"]) await writeFile(join(root, name), "");

    expect(compareListings(before, await listFiles(setup(), root), 2)).toEqual({
      status: "checked",
      files: [
        { path: "a", change: "created" },
        { path: "b", change: "created" },
      ],
      more: 1,
    });
  });

  it("says the changes are unchecked when either listing failed", () => {
    const failed = { ok: false, reason: "Too many." } as const;
    const listed = { ok: true, files: new Map() } as const;

    expect(compareListings(failed, listed, 10)).toEqual({
      status: "unchecked",
      reason: "Too many.",
    });
    expect(compareListings(listed, failed, 10)).toEqual({
      status: "unchecked",
      reason: "Too many.",
    });
  });
});
