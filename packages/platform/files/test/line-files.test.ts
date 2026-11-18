/**
 * A file of lines that only grows: each line added starts on a line of its
 * own, even after a write a crash cut off.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { appendLine } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("adding a line to a file of lines", () => {
  it("creates the file with the line when there is none", async () => {
    const file = join(await folders.make("zhiyin-lines-"), "log.jsonl");

    await appendLine(file, "first");

    expect(await readFile(file, "utf8")).toBe("first\n");
  });

  it("adds each line after the ones before it", async () => {
    const file = join(await folders.make("zhiyin-lines-"), "log.jsonl");

    await appendLine(file, "first");
    await appendLine(file, "second");

    expect(await readFile(file, "utf8")).toBe("first\nsecond\n");
  });

  it("starts a line of its own after a last line a crash cut off", async () => {
    const file = join(await folders.make("zhiyin-lines-"), "log.jsonl");
    await writeFile(file, 'whole\n{"cut', "utf8");

    await appendLine(file, "next");

    expect((await readFile(file, "utf8")).split("\n")).toEqual([
      "whole",
      '{"cut',
      "next",
      "",
    ]);
  });

  it("adds to an empty file without a blank line first", async () => {
    const file = join(await folders.make("zhiyin-lines-"), "log.jsonl");
    await writeFile(file, "", "utf8");

    await appendLine(file, "only");

    expect(await readFile(file, "utf8")).toBe("only\n");
  });
});
