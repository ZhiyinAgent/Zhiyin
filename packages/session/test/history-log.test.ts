import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { HistoryLog, historyFiles } from "../src/history-log.js";
import { changesBetween } from "../src/history-changes.js";

/**
 * One document kept as a file that only grows: its whole state once, then
 * each save's edits as one line. A line is a whole save or nothing.
 */

/** Where a log is kept, in a folder of its own. */
async function temporaryFile(): Promise<string> {
  const root = await folders.make("zhiyin-history-log-");
  return join(root, "conversation.jsonl");
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function saved(
  file: string,
  states: readonly unknown[],
  files = historyFiles,
): Promise<HistoryLog> {
  const log = await HistoryLog.create(file, states[0], files);
  for (let index = 1; index < states.length; index += 1)
    await log.write(
      changesBetween(states[index - 1], states[index]),
      states[index],
    );
  return log;
}

/** The log, checked to be the only file beside it. */
async function onlyFile(file: string): Promise<string> {
  expect(await readdir(join(file, ".."))).toEqual([basename(file)]);
  return file;
}

describe("a history log", () => {
  it("gives back the last state saved, after it is opened again", async () => {
    const file = await temporaryFile();
    await saved(file, [
      { title: "A", text: "" },
      { title: "A", text: "Hello" },
      { title: "B", text: "Hello there" },
    ]);

    const read = await HistoryLog.open(file);

    expect(read.state).toEqual({ title: "B", text: "Hello there" });
    expect(read.lost).toBe(false);
  });

  it("drops a save that was only half written, and says so", async () => {
    const file = await temporaryFile();
    await saved(file, [{ text: "" }, { text: "Kept" }]);
    await appendFile(await onlyFile(file), '{"changes":[{"p":["te', "utf8");

    const read = await HistoryLog.open(file);

    expect(read.state).toEqual({ text: "Kept" });
    expect(read.lost).toBe(true);
  });

  it("goes on saving after a half-written save, without the broken line", async () => {
    const file = await temporaryFile();
    await saved(file, [{ text: "" }, { text: "Kept" }]);
    await appendFile(await onlyFile(file), '{"changes":[{"p"', "utf8");
    const { log } = await HistoryLog.open(file);

    await log.write(changesBetween({ text: "Kept" }, { text: "Kept on" }), {
      text: "Kept on",
    });

    const read = await HistoryLog.open(file);
    expect(read.state).toEqual({ text: "Kept on" });
    expect(read.lost).toBe(false);
  });

  it("refuses a log damaged anywhere but its last line", async () => {
    const file = await temporaryFile();
    await saved(file, [{ text: "" }, { text: "a" }, { text: "ab" }]);
    await onlyFile(file);
    const lines = (await readFile(file, "utf8")).split("\n");
    lines[1] = "not a save";
    await writeFile(file, lines.join("\n"), "utf8");

    await expect(HistoryLog.open(file)).rejects.toThrow();
  });

  it("leaves the log as it was when an append fails part way", async () => {
    const file = await temporaryFile();
    await saved(file, [{ text: "" }, { text: "Kept" }]);
    const { log } = await HistoryLog.open(file, {
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

    const read = await HistoryLog.open(file);
    expect(read.state).toEqual({ text: "Kept" });
    expect(read.lost).toBe(false);
  });

  it("starts a fresh file holding the whole state once the edits outgrow it", async () => {
    const file = await temporaryFile();
    // Each save replaces the whole text, so its edits are as large as the
    // state: kept as edits, 24 saves would take 24 times the state.
    const states = Array.from({ length: 24 }, (_, index) => ({
      text: `${index} `.padEnd(20_000, "x"),
    }));
    await saved(file, states);

    await onlyFile(file);
    expect((await readFile(file, "utf8")).length).toBeLessThan(
      6 * JSON.stringify(states.at(-1)).length,
    );
    expect((await HistoryLog.open(file)).state).toEqual(states.at(-1));
  });

  /**
   * A save reported as failed is sent again, so one already in the log would
   * be applied twice when the log is read back.
   */
  it("counts a save once it is in the log, even when a fresh file cannot be started", async () => {
    const file = await temporaryFile();
    const states = Array.from({ length: 24 }, (_, index) => ({
      text: `${index} `.padEnd(20_000, "x"),
    }));
    await HistoryLog.create(file, states[0]);
    const { log } = await HistoryLog.open(file, {
      ...historyFiles,
      create: async () => {
        throw new Error("Disk full");
      },
    });

    for (let index = 1; index < states.length; index += 1)
      await log.write(
        changesBetween(states[index - 1], states[index]),
        states[index],
      );

    expect((await HistoryLog.open(file)).state).toEqual(states.at(-1));
  });

  it("keeps the previous file when starting a fresh one did not finish", async () => {
    const file = await temporaryFile();
    await saved(file, [{ text: "" }, { text: "Kept" }]);
    await writeFile(`${file}.tmp`, '{"state":', "utf8");

    expect((await HistoryLog.open(file)).state).toEqual({ text: "Kept" });
  });
});
