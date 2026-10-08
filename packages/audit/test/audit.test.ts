import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAuditLog, type AuditEntry } from "../src/index.js";

async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zhiyin-audit-"));
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    at: "2026-09-05T10:00:00.000Z",
    taskId: "task-1",
    toolName: "multi_edit",
    kind: "quiet-retry",
    reason: "“Owner: Dana” was not found in notes.md.",
    ...overrides,
  };
}

describe("FileAuditLog", () => {
  it("keeps corrections the transcript deliberately does not show", async () => {
    const log = new FileAuditLog(await directory());

    await log.record(entry());
    await log.record(
      entry({
        at: "2026-09-05T10:00:01.000Z",
        kind: "repair-applied",
        before: '{"find":"Owner: Dana"}',
        after: '{"find":"Owner: Rowan"}',
      }),
    );

    await expect(log.read()).resolves.toEqual([
      entry(),
      entry({
        at: "2026-09-05T10:00:01.000Z",
        kind: "repair-applied",
        before: '{"find":"Owner: Dana"}',
        after: '{"find":"Owner: Rowan"}',
      }),
    ]);
  });

  it("records exactly why a repair was thrown away", async () => {
    const log = new FileAuditLog(await directory());

    await log.record(
      entry({ kind: "repair-rejected", cause: "content-changed" }),
    );
    await log.record(entry({ kind: "repair-rejected", cause: "handover" }));

    const kept = await log.read();
    expect(kept.map((item) => item.cause)).toEqual([
      "content-changed",
      "handover",
    ]);
  });

  it("survives a restart and reads back in the order things happened", async () => {
    const home = await directory();
    const first = new FileAuditLog(home);
    await first.record(entry({ at: "2026-09-05T10:00:00.000Z" }));
    await first.record(entry({ at: "2026-09-05T10:00:01.000Z" }));

    const second = new FileAuditLog(home);
    await second.record(entry({ at: "2026-09-05T10:00:02.000Z" }));

    expect((await second.read()).map((item) => item.at)).toEqual([
      "2026-09-05T10:00:00.000Z",
      "2026-09-05T10:00:01.000Z",
      "2026-09-05T10:00:02.000Z",
    ]);
  });

  it("commits overlapping records without losing any of them", async () => {
    const log = new FileAuditLog(await directory());

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
    const log = new FileAuditLog(home);
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

  it("reports nothing rather than failing when there is no log yet", async () => {
    await expect(new FileAuditLog(await directory()).read()).resolves.toEqual(
      [],
    );
  });

  it("returns only the most recent entries when asked for a limit", async () => {
    const log = new FileAuditLog(await directory());
    for (let index = 0; index < 5; index += 1)
      await log.record(entry({ at: `2026-09-05T10:00:0${index}.000Z` }));

    expect((await log.read(2)).map((item) => item.at)).toEqual([
      "2026-09-05T10:00:03.000Z",
      "2026-09-05T10:00:04.000Z",
    ]);
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
    const log = new FileAuditLog(home);
    for (let index = 5_000; index < 5_500; index += 1)
      await log.record(entry({ at: at(index) }));

    const kept = await log.read();
    expect(kept).toHaveLength(5_000);
    expect(kept[0]?.at).toBe(at(500));
    expect(kept.at(-1)?.at).toBe(at(5_499));
  });

  it("does not read a file written by something else as audit history", async () => {
    const home = await directory();
    await writeFile(
      join(home, "corrections.log"),
      '{"unrelated":true}\n[1,2,3]\n"a string"\n',
      "utf8",
    );

    await expect(new FileAuditLog(home).read()).resolves.toEqual([]);
  });
});
