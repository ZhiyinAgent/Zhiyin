import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { FileCorrectionsLog, type CorrectionEntry } from "../src/index.js";
import { fakeCorrectionsLog } from "./fakes.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function directory(): Promise<string> {
  return folders.make("zhiyin-corrections-");
}

function entry(overrides: Partial<CorrectionEntry> = {}): CorrectionEntry {
  return {
    at: "2026-09-05T10:00:00.000Z",
    taskId: "task-1",
    toolName: "multi_edit",
    kind: "quiet-retry",
    reason: "“Owner: Dana” was not found in notes.md.",
    ...overrides,
  };
}

/**
 * Has another program hold `path` open as some backup tools and editors do:
 * it can still be read and added to, but not replaced, until released.
 */
async function holdAgainstReplacement(
  path: string,
): Promise<() => Promise<void>> {
  const holder = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$held = [System.IO.File]::Open($env:ZHIYIN_HELD, 'Open', 'Read', 'ReadWrite'); [Console]::Out.WriteLine('held'); [void][Console]::In.ReadLine(); $held.Close()",
    ],
    {
      env: { ...process.env, ZHIYIN_HELD: path },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const exited = once(holder, "exit");
  await Promise.race([
    once(holder.stdout, "data"),
    exited.then(() => {
      throw new Error(`${path} could not be held.`);
    }),
  ]);
  return async () => {
    holder.stdin.end();
    await exited;
  };
}

/*
 * What the tests above this package rely on, held for the log on disk and for
 * the fake they use in its place (ADR 0002).
 */
describe.each([
  ["the log on disk", async () => new FileCorrectionsLog(await directory())],
  ["the fake", async () => fakeCorrectionsLog()],
] as const)("%s", (_, made) => {
  it("reads empty before anything is recorded", async () => {
    await expect((await made()).read()).resolves.toEqual([]);
  });

  it("reads back each entry as recorded, in the order recorded", async () => {
    const log = await made();
    const later = entry({
      at: "2026-09-05T10:00:01.000Z",
      kind: "input-corrected",
      before: '{"find":"Owner: Dana",}',
      after: '{"find":"Owner: Dana"}',
      inRow: 2,
    });

    await log.record(entry());
    await log.record(later);

    await expect(log.read()).resolves.toEqual([entry(), later]);
  });
});

describe("FileCorrectionsLog", () => {
  it("keeps corrections the transcript deliberately does not show", async () => {
    const log = new FileCorrectionsLog(await directory());

    await log.record(entry());
    await log.record(
      entry({
        at: "2026-09-05T10:00:01.000Z",
        kind: "input-corrected",
        before: '{"find":"Owner: Dana"}',
        after: '{"find":"Owner: Rowan"}',
      }),
    );

    await expect(log.read()).resolves.toEqual([
      entry(),
      entry({
        at: "2026-09-05T10:00:01.000Z",
        kind: "input-corrected",
        before: '{"find":"Owner: Dana"}',
        after: '{"find":"Owner: Rowan"}',
      }),
    ]);
  });

  it("survives a restart and reads back in the order things happened", async () => {
    const home = await directory();
    const first = new FileCorrectionsLog(home);
    await first.record(entry({ at: "2026-09-05T10:00:00.000Z" }));
    await first.record(entry({ at: "2026-09-05T10:00:01.000Z" }));

    const second = new FileCorrectionsLog(home);
    await second.record(entry({ at: "2026-09-05T10:00:02.000Z" }));

    expect((await second.read()).map((item) => item.at)).toEqual([
      "2026-09-05T10:00:00.000Z",
      "2026-09-05T10:00:01.000Z",
      "2026-09-05T10:00:02.000Z",
    ]);
  });

  it("commits overlapping records without losing any of them", async () => {
    const log = new FileCorrectionsLog(await directory());

    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        log.record(
          entry({
            at: `2026-09-05T10:00:${String(index).padStart(2, "0")}.000Z`,
          }),
        ),
      ),
    );

    expect(await log.read()).toHaveLength(50);
  });

  it("skips a damaged line rather than losing the whole record", async () => {
    const home = await directory();
    const log = new FileCorrectionsLog(home);
    await log.record(entry());
    await appendFile(join(home, "corrections.log"), "{ not json\n", "utf8");
    await log.record(entry({ at: "2026-09-05T10:00:02.000Z" }));

    const kept = await log.read();
    expect(kept).toHaveLength(2);
    expect(kept.map((item) => item.at)).toEqual([
      "2026-09-05T10:00:00.000Z",
      "2026-09-05T10:00:02.000Z",
    ]);
  });

  it("loses only a line cut short by a crash, not the entry written after it", async () => {
    const home = await directory();
    await new FileCorrectionsLog(home).record(entry());
    // Zhiyin closed part way through writing the next line.
    await appendFile(
      join(home, "corrections.log"),
      '{"at":"2026-09-05T10:00:01.000Z","taskId":"ta',
      "utf8",
    );

    await new FileCorrectionsLog(home).record(
      entry({ at: "2026-09-05T10:00:02.000Z" }),
    );

    const kept = await new FileCorrectionsLog(home).read();
    expect(kept.map((item) => item.at)).toEqual([
      "2026-09-05T10:00:00.000Z",
      "2026-09-05T10:00:02.000Z",
    ]);
  });

  it("keeps to its limit across restarts, however few each run records", async () => {
    const home = await directory();
    const at = (index: number) =>
      new Date(Date.UTC(2026, 8, 5) + index * 1000).toISOString();
    await writeFile(
      join(home, "corrections.log"),
      Array.from(
        { length: 5_010 },
        (_, index) => `${JSON.stringify(entry({ at: at(index) }))}\n`,
      ).join(""),
      "utf8",
    );

    await new FileCorrectionsLog(home).record(entry({ at: at(5_010) }));

    const kept = await new FileCorrectionsLog(home).read();
    expect(kept).toHaveLength(5_000);
    expect(kept.at(-1)?.at).toBe(at(5_010));
  });

  it("leaves the log as it was, and nothing beside it, when it cannot be trimmed", async () => {
    const home = await directory();
    const log = join(home, "corrections.log");
    const at = (index: number) =>
      new Date(Date.UTC(2026, 8, 5) + index * 1000).toISOString();
    await writeFile(
      log,
      Array.from(
        { length: 5_000 },
        (_, index) => `${JSON.stringify(entry({ at: at(index) }))}\n`,
      ).join(""),
      "utf8",
    );
    const release = await holdAgainstReplacement(log);

    try {
      // The entry is added, which takes the log past its limit, and the
      // shortened log cannot take the place of the long one.
      await expect(
        new FileCorrectionsLog(home).record(entry({ at: at(5_000) })),
      ).rejects.toThrow();
    } finally {
      await release();
    }

    expect(await readdir(home)).toEqual(["corrections.log"]);
    expect(await new FileCorrectionsLog(home).read()).toHaveLength(5_001);
  });

  it("reports nothing rather than failing when there is no log yet", async () => {
    await expect(
      new FileCorrectionsLog(await directory()).read(),
    ).resolves.toEqual([]);
  });

  it("keeps the newest 5,000 corrections and drops the oldest", async () => {
    const home = await directory();
    const at = (index: number) =>
      new Date(Date.UTC(2026, 8, 5) + index * 1000).toISOString();
    await writeFile(
      join(home, "corrections.log"),
      Array.from(
        { length: 5_000 },
        (_, index) => `${JSON.stringify(entry({ at: at(index) }))}\n`,
      ).join(""),
      "utf8",
    );
    const log = new FileCorrectionsLog(home);
    for (let index = 5_000; index < 5_500; index += 1)
      await log.record(entry({ at: at(index) }));

    const kept = await log.read();
    expect(kept).toHaveLength(5_000);
    expect(kept[0]?.at).toBe(at(500));
    expect(kept.at(-1)?.at).toBe(at(5_499));
  });

  it("does not read a file written by something else as corrections", async () => {
    const home = await directory();
    await writeFile(
      join(home, "corrections.log"),
      '{"unrelated":true}\n[1,2,3]\n"a string"\n',
      "utf8",
    );

    await expect(new FileCorrectionsLog(home).read()).resolves.toEqual([]);
  });
});
