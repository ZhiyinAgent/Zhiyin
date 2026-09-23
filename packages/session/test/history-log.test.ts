import {
  appendFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryLog, historyFiles } from "../src/history-log.js";
import { changesBetween } from "../src/history-changes.js";

/**
 * One document kept as a file that only grows: its whole state once, then
 * each save's edits as one line. A line is a whole save or nothing.
 */

const roots: string[] = [];

async function temporaryFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-history-log-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function saved(
  folder: string,
  states: readonly unknown[],
  files = historyFiles,
): Promise<HistoryLog> {
  const log = await HistoryLog.create(folder, states[0], files);
  for (let index = 1; index < states.length; index += 1)
    await log.write(
      changesBetween(states[index - 1], states[index]),
      states[index],
    );
  return log;
}

async function onlyFile(folder: string): Promise<string> {
  const names = (await readdir(folder)).filter((name) =>
    name.endsWith(".jsonl"),
  );
  expect(names).toHaveLength(1);
  return join(folder, names[0]!);
}

describe("a history log", () => {
  it("gives back the last state saved, after it is opened again", async () => {
    const folder = await temporaryFolder();
    await saved(folder, [
      { title: "A", text: "" },
      { title: "A", text: "Hello" },
      { title: "B", text: "Hello there" },
    ]);

    const read = await HistoryLog.open(folder);

    expect(read.state).toEqual({ title: "B", text: "Hello there" });
    expect(read.lost).toBe(false);
  });

  it("drops a save that was only half written, and says so", async () => {
    const folder = await temporaryFolder();
    await saved(folder, [{ text: "" }, { text: "Kept" }]);
    await appendFile(await onlyFile(folder), '{"changes":[{"p":["te', "utf8");

    const read = await HistoryLog.open(folder);

    expect(read.state).toEqual({ text: "Kept" });
    expect(read.lost).toBe(true);
  });

  it("goes on saving after a half-written save, without the broken line", async () => {
    const folder = await temporaryFolder();
    await saved(folder, [{ text: "" }, { text: "Kept" }]);
    await appendFile(await onlyFile(folder), '{"changes":[{"p"', "utf8");
    const { log } = await HistoryLog.open(folder);

    await log.write(changesBetween({ text: "Kept" }, { text: "Kept on" }), {
      text: "Kept on",
    });

    const read = await HistoryLog.open(folder);
    expect(read.state).toEqual({ text: "Kept on" });
    expect(read.lost).toBe(false);
  });

  it("refuses a log damaged anywhere but its last line", async () => {
    const folder = await temporaryFolder();
    await saved(folder, [{ text: "" }, { text: "a" }, { text: "ab" }]);
    const file = await onlyFile(folder);
    const lines = (await readFile(file, "utf8")).split("\n");
    lines[1] = "not a save";
    await writeFile(file, lines.join("\n"), "utf8");

    await expect(HistoryLog.open(folder)).rejects.toThrow();
  });

  it("leaves the log as it was when an append fails part way", async () => {
    const folder = await temporaryFolder();
    await saved(folder, [{ text: "" }, { text: "Kept" }]);
    const { log } = await HistoryLog.open(folder, {
      ...historyFiles,
      append: async (path, text) => {
        await appendFile(path, text.slice(0, 5), "utf8");
        throw new Error("Disk full");
      },
    });

    await expect(
      log.write(changesBetween({ text: "Kept" }, { text: "Lost" }), {
        text: "Lost",
      }),
    ).rejects.toThrow("Disk full");

    const read = await HistoryLog.open(folder);
    expect(read.state).toEqual({ text: "Kept" });
    expect(read.lost).toBe(false);
  });

  it("starts a fresh file holding the whole state once the edits outgrow it", async () => {
    const folder = await temporaryFolder();
    const states = Array.from({ length: 400 }, (_, index) => ({
      text: "x".repeat(index * 400),
    }));
    await saved(folder, [{ text: "" }, ...states.slice(1)]);

    const file = await onlyFile(folder);
    expect((await readFile(file, "utf8")).length).toBeLessThan(
      4 * JSON.stringify(states.at(-1)).length + 70_000,
    );
    expect((await HistoryLog.open(folder)).state).toEqual(states.at(-1));
  });

  it("keeps the previous file when starting a fresh one did not finish", async () => {
    const folder = await temporaryFolder();
    await saved(folder, [{ text: "" }, { text: "Kept" }]);
    await writeFile(join(folder, "log-999999.jsonl.tmp"), '{"state":', "utf8");

    expect((await HistoryLog.open(folder)).state).toEqual({ text: "Kept" });
  });
});
