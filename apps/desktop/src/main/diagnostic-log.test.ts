// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiagnosticLog, recordCrashes } from "./diagnostic-log.js";

/**
 * What is left behind for whoever has to find out what went wrong on a
 * person's computer: one line per event, in a file per day, on this computer
 * only, and never so much that it fills the disk.
 */

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function logsFolder() {
  const path = await mkdtemp(join(tmpdir(), "zhiyin-logs-"));
  folders.push(path);
  return path;
}

const at = (iso: string) => () => new Date(iso);

async function lines(folder: string, day: string) {
  const text = await readFile(join(folder, `${day}.jsonl`), "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("the diagnostic log", () => {
  it("writes one line per entry into the day's file", async () => {
    const folder = await logsFolder();
    const log = new DiagnosticLog(folder, at("2026-09-23T10:00:00.000Z"));

    log.record({ level: "warn", source: "shutdown", message: "first" });
    log.record({ level: "info", source: "window", message: "second" });

    expect(await lines(folder, "2026-09-23")).toEqual([
      {
        time: "2026-09-23T10:00:00.000Z",
        level: "warn",
        source: "shutdown",
        message: "first",
      },
      {
        time: "2026-09-23T10:00:00.000Z",
        level: "info",
        source: "window",
        message: "second",
      },
    ]);
  });

  it("keeps where an error came from", async () => {
    const folder = await logsFolder();
    const log = new DiagnosticLog(folder, at("2026-09-23T10:00:00.000Z"));

    log.record({
      level: "error",
      source: "main",
      message: "Uncaught exception",
      error: new TypeError("broken"),
    });

    const [entry] = await lines(folder, "2026-09-23");
    expect(entry?.["error"]).toMatchObject({
      name: "TypeError",
      message: "broken",
      stack: expect.stringContaining("diagnostic-log.test.ts"),
    });
  });

  it("removes days older than two weeks, and nothing else", async () => {
    const folder = await logsFolder();
    for (const name of [
      "2026-09-08.jsonl",
      "2026-09-09.jsonl",
      "2026-09-10.jsonl",
      "notes.txt",
    ])
      await writeFile(join(folder, name), "", "utf8");

    new DiagnosticLog(folder, at("2026-09-23T10:00:00.000Z")).prune();

    expect((await readdir(folder)).sort()).toEqual([
      "2026-09-09.jsonl",
      "2026-09-10.jsonl",
      "notes.txt",
    ]);
  });

  it("never throws, even where it cannot write", async () => {
    const folder = await logsFolder();
    // A file where the folder should be.
    await writeFile(join(folder, "blocked"), "", "utf8");
    const log = new DiagnosticLog(join(folder, "blocked"));

    expect(() =>
      log.record({ level: "error", source: "main", message: "lost" }),
    ).not.toThrow();
    expect(() => log.prune()).not.toThrow();
  });
});

describe("a crash in the main process", () => {
  it("is recorded, and the process is left running", async () => {
    const folder = await logsFolder();
    const log = new DiagnosticLog(folder, at("2026-09-23T10:00:00.000Z"));
    const main = new EventEmitter();
    recordCrashes(main, log);

    main.emit("uncaughtException", new Error("thrown and not caught"));
    main.emit("unhandledRejection", "rejected and not handled");

    expect(await lines(folder, "2026-09-23")).toMatchObject([
      {
        level: "error",
        message: "An exception was not caught.",
        error: { message: "thrown and not caught" },
      },
      {
        level: "error",
        message: "A rejected promise was not handled.",
        error: { message: "rejected and not handled" },
      },
    ]);
  });
});
