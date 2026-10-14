import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { TemporaryFolders } from "../src/index.js";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("temporary folders", () => {
  it("makes a new, empty folder in the system's temporary folder, named from the prefix", async () => {
    const folders = new TemporaryFolders();
    const first = await folders.make("zhiyin-folders-");
    const second = await folders.make("zhiyin-folders-");

    expect(dirname(first)).toBe(tmpdir());
    expect(basename(first).startsWith("zhiyin-folders-")).toBe(true);
    expect(second).not.toBe(first);
    expect(await readdir(first)).toEqual([]);
    await folders.removeAll();
  });

  it("removes every folder it made, with what is inside", async () => {
    const folders = new TemporaryFolders();
    const first = await folders.make("zhiyin-folders-");
    const second = await folders.make("zhiyin-folders-");
    await mkdir(join(first, "nested", "deeper"), { recursive: true });
    await writeFile(join(first, "nested", "deeper", "notes.md"), "kept");

    await folders.removeAll();

    expect(await exists(first)).toBe(false);
    expect(await exists(second)).toBe(false);
  });

  it("does not fail for a folder a test already removed", async () => {
    const folders = new TemporaryFolders();
    const folder = await folders.make("zhiyin-folders-");
    await rm(folder, { recursive: true });

    await expect(folders.removeAll()).resolves.toBeUndefined();
  });

  it("removes a folder only once, and the folders made after it next time", async () => {
    const folders = new TemporaryFolders();
    const before = await folders.make("zhiyin-folders-");
    await folders.removeAll();
    const after = await folders.make("zhiyin-folders-");

    await folders.removeAll();

    expect(await exists(before)).toBe(false);
    expect(await exists(after)).toBe(false);
  });
});
