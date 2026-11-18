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

  it("counts a request's own work against its time limit, not the time it waited behind others", async () => {
    const processes = starting(() => fixtureProcess("one-at-a-time.mjs"));
    const host = new DrawingHost({
      start: processes.start,
      containment,
      // Each request takes 600 ms of work; four at once take 2.4 s in all.
      timeoutMs: 1_500,
    });

    const bytes = new Uint8Array(pdf());
    const answers = await Promise.all(
      ["r1", "r2", "r3", "r4"].map((revision) =>
        host.open(revision, "pdf", bytes),
      ),
    );

    expect(answers).toEqual(
      Array.from({ length: 4 }, () => ({
        ok: true,
        kind: "opened",
        pages: [{ width: 816, height: 1056 }],
      })),
    );
    expect(processes.started).toHaveLength(1);
    host.close();
  });

  it("ends its process after a while with no request, and draws the same document again in a new one", async () => {
    const processes = starting(() => fixtureProcess("draws.mjs"));
    const host = new DrawingHost({
      start: processes.start,
      containment,
      idleMs: 200,
    });
    await host.open("r1", "pdf", new Uint8Array(pdf()));
    await expect(host.draw("r1", 1, 300)).resolves.toMatchObject({
      ok: true,
      kind: "drawn",
    });
    expect(await gone(processes.started[0]!.pid)).toBe(true);

    // The new process is given the document before it is asked for a page.
    await expect(host.draw("r1", 1, 300)).resolves.toMatchObject({
      ok: true,
      kind: "drawn",
      width: 300,
    });
    expect(processes.started).toHaveLength(2);
    host.close();
  });

  it("does not end a process while a request is still being worked on, however long it takes", async () => {
    const processes = starting(() => fixtureProcess("one-at-a-time.mjs"));
    const host = new DrawingHost({
      start: processes.start,
      containment,
      // Each request takes 600 ms of work, three times the idle limit.
      idleMs: 200,
    });
    const bytes = new Uint8Array(pdf());
    const answers = await Promise.all(
      ["r1", "r2"].map((revision) => host.open(revision, "pdf", bytes)),
    );

    expect(answers).toEqual(
      Array.from({ length: 2 }, () => expect.objectContaining({ ok: true })),
    );
    expect(processes.started).toHaveLength(1);
    host.close();
  });

  it("ends a process once idle even while it is still letting go of a document", async () => {
    // This process answers the open and then nothing, so the release waits.
    const processes = starting(() =>
      fixtureProcess("opens-then-never-answers.mjs"),
    );
    const host = new DrawingHost({
      start: processes.start,
      containment,
      idleMs: 200,
    });
    await host.open("r1", "pdf", new Uint8Array(pdf()));
    const started = Date.now();
    const released = host.release("r1");
    expect(await gone(processes.started[0]!.pid)).toBe(true);

    // Well within the ten seconds that would end it for taking too long.
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect(released).resolves.toEqual({ ok: false, failure: "ended" });
    host.close();
  });

  it("starts no process to let go of a document", async () => {
    const processes = starting(() => fixtureProcess("draws.mjs"));
    const host = new DrawingHost({
      start: processes.start,
      containment,
      idleMs: 200,
    });
    await expect(host.release("r0")).resolves.toEqual({
      ok: true,
      kind: "released",
    });
    expect(processes.started).toHaveLength(0);

    await host.open("r1", "pdf", new Uint8Array(pdf()));
    expect(await gone(processes.started[0]!.pid)).toBe(true);
    await expect(host.release("r1")).resolves.toEqual({
      ok: true,
      kind: "released",
    });
    // Let go of, it is not given to the next process.
    await expect(host.draw("r1", 1, 300)).resolves.toEqual({
      ok: false,
      failure: "not-open",
    });
    expect(processes.started).toHaveLength(1);
    host.close();
  });

  it("ends a process that commits more memory than it is allowed, and only that process", async () => {
    const processes = starting(() => fixtureProcess("allocates.mjs"));
    const host = new DrawingHost({
      start: processes.start,
      containment,
      processMemoryLimit: 256 * 1024 * 1024,
    });
    await expect(
      host.open("r1", "pdf", new Uint8Array(pdf())),
    ).resolves.toEqual({
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

  it("answers a request whose process could not be started as uncontained, and tries again on the next request", async () => {
    let attempts = 0;
    const host = new DrawingHost({
      start: async () => {
        attempts += 1;
        if (attempts === 1)
          throw new Error("The drawing process ended at once (1).");
        return serviceProcess();
      },
      containment,
    });
    const bytes = new Uint8Array(pdf());

    await expect(host.open("r1", "pdf", bytes)).resolves.toEqual({
      ok: false,
      failure: "uncontained",
    });
    await expect(host.open("r1", "pdf", bytes)).resolves.toMatchObject({
      ok: true,
    });
    host.close();
  });

  it("ends its process when closed", async () => {
    const processes = starting(() => fixtureProcess("never-answers.mjs"));
    const host = new DrawingHost({ start: processes.start, containment });
    void host.open("r1", "pdf", new Uint8Array(pdf()));
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
    await expect(
      host.open("r1", "pdf", new Uint8Array(pdf())),
    ).resolves.toEqual({
      ok: false,
      failure: "uncontained",
    });
    expect(await gone(processes.started[0]!.pid)).toBe(true);
  });
});
