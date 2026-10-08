import { describe, expect, it } from "vitest";
import { DrawingHost, type DrawingProcess } from "../src/index.js";
import { pdf } from "./pdf-builder.js";
import {
  alive,
  containment,
  fixtureProcess,
  serviceProcess,
} from "./processes.js";

/** Starts each process in turn from the list, recording what it started. */
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

async function gone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (alive(pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  return !alive(pid);
}

describe.runIf(process.platform === "win32")("the drawing host", () => {
  it("ends a process stuck on a page, says the page could not be drawn, and draws the next with a new one", async () => {
    const processes = starting(
      () => fixtureProcess("never-answers.mjs"),
      serviceProcess,
    );
    const host = new DrawingHost({
      start: processes.start,
      containment,
      // Long enough for the real drawing that follows to load pdf.js on a busy
      // machine; the stuck process waits it out either way.
      timeoutMs: 5_000,
    });
    const bytes = new Uint8Array(pdf({ pages: 2 }));
    await expect(host.open("r1", "pdf", bytes)).resolves.toEqual({
      ok: false,
      failure: "timed-out",
    });
    expect(await gone(processes.started[0]!.pid)).toBe(true);

    await expect(host.draw("r1", 2, 300)).resolves.toMatchObject({
      ok: true,
      kind: "drawn",
      width: 300,
    });
    expect(processes.started).toHaveLength(2);
    host.close();
  });

  it("ends a process that commits more memory than it is allowed, and only that process", async () => {
    const processes = starting(() => fixtureProcess("allocates.mjs"));
    const host = new DrawingHost({
      start: processes.start,
      containment,
      processMemoryLimit: 256 * 1024 * 1024,
    });
    await expect(host.release("r1")).resolves.toEqual({
      ok: false,
      failure: "ended",
    });
    expect(await gone(processes.started[0]!.pid)).toBe(true);
    host.close();
  });

  it("says a page could not be drawn when its process falls over, and starts another", async () => {
    const processes = starting(
      () => fixtureProcess("ends-at-once.mjs"),
      serviceProcess,
    );
    const host = new DrawingHost({ start: processes.start, containment });
    const bytes = new Uint8Array(pdf());
    await expect(host.open("r1", "pdf", bytes)).resolves.toEqual({
      ok: false,
      failure: "ended",
    });
    await expect(host.draw("r1", 1, 200)).resolves.toMatchObject({
      ok: true,
      width: 200,
    });
    host.close();
  });

  it("ends its process when closed", async () => {
    const processes = starting(() => fixtureProcess("never-answers.mjs"));
    const host = new DrawingHost({ start: processes.start, containment });
    void host.release("r1");
    while (!processes.started.length)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 100));
    host.close();
    expect(await gone(processes.started[0]!.pid)).toBe(true);
  });

  it("draws nothing in a process it could not contain, and ends it", async () => {
    const processes = starting(() => fixtureProcess("never-answers.mjs"));
    const host = new DrawingHost({
      start: processes.start,
      containment: {
        open: () => ({
          contain: () => {
            throw new Error("not here");
          },
          close: () => undefined,
        }),
      },
    });
    await expect(host.release("r1")).resolves.toEqual({
      ok: false,
      failure: "uncontained",
    });
    expect(await gone(processes.started[0]!.pid)).toBe(true);
  });
});
