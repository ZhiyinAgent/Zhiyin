import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { DictionaryShelf } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const bytes = Buffer.from("BDic dictionary bytes for the test");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const dictionary = {
  language: "fr",
  file: "fr-FR-3-0.bdic",
  sha256,
  bytes: bytes.length,
};

async function onDisk() {
  const root = await folders.make("zhiyin-spelling-");
  const bundled = join(root, "bundled");
  const installed = join(root, "session", "Dictionaries");
  await mkdir(bundled, { recursive: true });
  return {
    bundled,
    installed,
    shelf: new DictionaryShelf({ bundled, installed }),
  };
}

describe("placing a dictionary", () => {
  it("places a bundled dictionary, and leaves a correct one alone", async () => {
    const { bundled, installed, shelf } = await onDisk();
    await writeFile(join(bundled, dictionary.file), bytes);

    expect(await shelf.place(dictionary)).toBe("placed");
    expect(await readFile(join(installed, dictionary.file))).toEqual(bytes);

    await rm(join(bundled, dictionary.file));
    expect(await shelf.place(dictionary)).toBe("placed");
    // Nothing half-written is left beside it.
    expect(await readdir(installed)).toEqual([dictionary.file]);
  });

  it("replaces a placed dictionary that was damaged", async () => {
    const { bundled, installed, shelf } = await onDisk();
    await writeFile(join(bundled, dictionary.file), bytes);
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, dictionary.file), "cut off");

    expect(await shelf.place(dictionary)).toBe("placed");
    expect(await readFile(join(installed, dictionary.file))).toEqual(bytes);
  });

  it("never places a bundled dictionary whose checksum is wrong", async () => {
    const { bundled, installed, shelf } = await onDisk();
    await writeFile(join(bundled, dictionary.file), "not the dictionary");

    expect(await shelf.place(dictionary)).toBe("damaged");
    expect(await readdir(installed).catch(() => [])).toEqual([]);
  });

  it("says when the bundle has no such dictionary", async () => {
    const { shelf } = await onDisk();

    expect(await shelf.place(dictionary)).toBe("missing");
  });
});
