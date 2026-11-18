import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { holdOpen, TemporaryFolders } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

async function aFile() {
  const folder = await folders.make("zhiyin-held-");
  const file = join(folder, "notes.txt");
  await writeFile(file, "kept");
  return { folder, file };
}

describe("holding a file the way another program does", () => {
  it("lets it be read but not replaced or removed while held", async () => {
    const { folder, file } = await aFile();
    const other = join(folder, "other.txt");
    await writeFile(other, "new");
    const release = holdOpen(file);

    try {
      expect(await readFile(file, "utf8")).toBe("kept");
      await expect(rename(other, file)).rejects.toMatchObject({
        code: "EPERM",
      });
      await expect(rm(file)).rejects.toMatchObject({ code: "EBUSY" });
    } finally {
      release();
    }
  });

  it("lets nothing read it when it shares nothing", async () => {
    const { file } = await aFile();
    const release = holdOpen(file, "nothing");

    try {
      await expect(readFile(file, "utf8")).rejects.toMatchObject({
        code: "EBUSY",
      });
    } finally {
      release();
    }
  });

  it("lets it be replaced once let go, and letting go twice is harmless", async () => {
    const { folder, file } = await aFile();
    const other = join(folder, "other.txt");
    await writeFile(other, "new");
    const release = holdOpen(file);

    release();
    release();
    await rename(other, file);

    expect(await readFile(file, "utf8")).toBe("new");
  });

  it("says when there is no file to hold", async () => {
    const { folder } = await aFile();

    expect(() => holdOpen(join(folder, "missing.txt"))).toThrow(
      "could not be held",
    );
  });
});
