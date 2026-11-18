/**
 * A folder's files as the bundled ripgrep lists them, and two listings
 * compared. Real ripgrep and real files, because what ripgrep chooses is what
 * is being shown.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
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

  it("refuses a folder holding more files than it may list, saying so", async () => {
    const root = await folderWith({ a: "", b: "", c: "" });

    expect(await listFiles(setup(2), root)).toEqual({
      ok: false,
      reason:
        "This folder has more than 2 files, too many to check what commands change.",
    });
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
