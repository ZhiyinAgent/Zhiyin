/**
 * A PDF the model reads is read in a contained process, as a PDF the person
 * sees is drawn in one: a document that hangs pdf.js costs one answer, not the
 * core.
 */

import { describe, expect, it } from "vitest";
import { ContainedPdfPages, type DrawingProcess } from "../src/index.js";
import { pdf } from "./pdf-builder.js";
import {
  alive,
  containment,
  fixtureProcess,
  serviceProcess,
} from "./processes.js";

function starting(...kinds: (() => Promise<DrawingProcess>)[]) {
  const started: DrawingProcess[] = [];
  return {
    started,
    start: async () => {
      const next = kinds[Math.min(started.length, kinds.length - 1)]!;
      const process = await next();
      started.push(process);
      return process;
    },
  };
}

describe.runIf(process.platform === "win32")("a PDF read for the model", () => {
  it("is opened with each page's size in points, its words read and a page drawn, in the reading process", async () => {
    const processes = starting(serviceProcess);
    const pages = new ContainedPdfPages({
      start: processes.start,
      containment,
    });
    const opened = await pages.open(
      new Uint8Array(pdf({ pages: 2, size: { width: 612, height: 792 } })),
    );
    if (!opened.ok) throw new Error(opened.failure);
    expect(opened.pages).toEqual([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ]);
    await expect(opened.text(2)).resolves.toEqual(["Page 2"]);
    const jpeg = await opened.picture(1, 1, 80);
    expect(jpeg && [...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    opened.close();
    pages.close();
  });

  it("reads the words of every page, line by line, and nothing for a file it cannot open", async () => {
    const pages = new ContainedPdfPages({
      start: starting(serviceProcess).start,
      containment,
    });

    await expect(
      pages.words(new Uint8Array(pdf({ pages: 2, lines: ["One", "Two"] }))),
    ).resolves.toEqual(["One\nTwo", "One\nTwo"]);
    await expect(
      pages.words(new Uint8Array(Buffer.from("not a PDF"))),
    ).resolves.toBeUndefined();
    pages.close();
  });

  it("answers a page stuck in its process with nothing, within the time limit, and reads the next with a new process", async () => {
    const processes = starting(
      () => fixtureProcess("opens-then-never-answers.mjs"),
      serviceProcess,
    );
    const pages = new ContainedPdfPages({
      start: processes.start,
      containment,
      // Long enough for the real reading that follows to load pdf.js on a
      // busy machine; the stuck process waits it out either way.
      timeoutMs: 5_000,
    });
    const opened = await pages.open(new Uint8Array(pdf({ pages: 1 })));
    if (!opened.ok) throw new Error(opened.failure);
    const started = Date.now();
    await expect(opened.text(1)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(9_000);
    const stuck = processes.started[0]!.pid;
    const deadline = Date.now() + 10_000;
    while (alive(stuck) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(alive(stuck)).toBe(false);

    // The document is given to the new process, which reads it.
    await expect(opened.text(1)).resolves.toEqual(["Page 1"]);
    expect(processes.started).toHaveLength(2);
    opened.close();
    pages.close();
  });

  it("says a PDF it cannot open cannot be opened, and one it could not start a process for could not be started", async () => {
    const readable = new ContainedPdfPages({
      start: starting(serviceProcess).start,
      containment,
    });
    await expect(
      readable.open(new Uint8Array(Buffer.from("%PDF-1.7\nnothing here"))),
    ).resolves.toEqual({ ok: false, failure: "unopenable" });
    readable.close();

    const uncontained = new ContainedPdfPages({
      start: starting(() => fixtureProcess("never-answers.mjs")).start,
      containment: {
        open: () => ({
          contain: () => {
            throw new Error("No job.");
          },
          close: () => undefined,
        }),
      },
    });
    await expect(
      uncontained.open(new Uint8Array(pdf({ pages: 1 }))),
    ).resolves.toEqual({ ok: false, failure: "unstartable" });
    uncontained.close();
  });

  it("ends its process once nothing has been read for a while, and starts another for the next read", async () => {
    const processes = starting(() =>
      fixtureProcess("opens-then-never-answers.mjs"),
    );
    const pages = new ContainedPdfPages({
      start: processes.start,
      containment,
      idleMs: 200,
    });
    const opened = await pages.open(new Uint8Array(pdf({ pages: 1 })));
    if (!opened.ok) throw new Error(opened.failure);
    opened.close();
    const first = processes.started[0]!.pid;
    const deadline = Date.now() + 10_000;
    while (alive(first) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(alive(first)).toBe(false);

    await pages.open(new Uint8Array(pdf({ pages: 1 })));
    expect(processes.started).toHaveLength(2);
    pages.close();
  });
});
