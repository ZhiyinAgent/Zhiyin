/**
 * Comparing pixels on a thread of its own: the same answer as comparing them
 * here, a thread ended when its comparison is stopped or none is asked for a
 * while, and a thread that falls over answered as a failure. The threads that
 * stop and fall over are real Node workers.
 */

import { MessageChannel, Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  ComparisonThreads,
  comparedHere,
  serveComparisons,
  type ComparisonThread,
  type DrawnPart,
} from "../src/index.js";

/** A picture of one colour with a square of another, all of it compared. */
function picture(square?: [number, number, number]): DrawnPart {
  const width = 64;
  const height = 48;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const inSquare = square && x >= 20 && x < 36 && y >= 16 && y < 32;
      const [r, g, b] = inSquare ? square : [156, 200, 238];
      rgba.set([r, g, b, 255], at);
    }
  return {
    pixels: { rgba, width, height },
    rect: { x: 0, y: 0, width, height },
  };
}

/** Compared at the pictures' own size. */
const size = { width: 64, height: 48 };

/** The comparison service, served over a channel in this thread. */
function servedHere(): ComparisonThread & { readonly ended: boolean } {
  const { port1, port2 } = new MessageChannel();
  serveComparisons(port2);
  let ended = false;
  return {
    postMessage: (message, transfer) => port1.postMessage(message, transfer),
    on: ((event: string, listener: (value: unknown) => void) =>
      event === "message"
        ? port1.on("message", listener)
        : port1) as ComparisonThread["on"],
    terminate: async () => {
      ended = true;
      port1.close();
      port2.close();
      return 0;
    },
    unref: () => port1.unref(),
    get ended() {
      return ended;
    },
  } as ComparisonThread & { readonly ended: boolean };
}

/** A real worker running this code, which never compares anything. */
function workerRunning(code: string) {
  const workers: Worker[] = [];
  return {
    workers,
    start: (): ComparisonThread => {
      const worker = new Worker(code, { eval: true });
      workers.push(worker);
      return worker as unknown as ComparisonThread;
    },
  };
}

/** Resolves once the worker has ended. */
const ended = (worker: Worker) =>
  new Promise<void>((resolve) => {
    if (worker.threadId === -1) resolve();
    else worker.once("exit", () => resolve());
  });

const open: { close(): void }[] = [];
afterEach(() => {
  for (const threads of open.splice(0)) threads.close();
});

function threads(options: ConstructorParameters<typeof ComparisonThreads>[0]) {
  const made = new ComparisonThreads(options);
  open.push(made);
  return made;
}

describe("comparing pixels on a thread", () => {
  it("answers as comparing them here does, the sheet included", async () => {
    const first = picture();
    const second = picture([224, 16, 16]);
    const served = threads({ start: servedHere });

    const there = await served.compare(first, second, size);
    const here = await comparedHere.compare(first, second, size);

    expect(there).toEqual(here);
    if (typeof there === "string") throw new Error(there);
    expect(there.areas).toHaveLength(1);
    expect(there.sheet.length).toBeGreaterThan(0);
  });

  it("answers one small comparison after another on the same thread", async () => {
    const started: ComparisonThread[] = [];
    const served = threads({
      start: () => {
        const thread = servedHere();
        started.push(thread);
        return thread;
      },
    });

    for (let round = 0; round < 3; round += 1)
      await expect(
        served.compare(picture(), picture(), size),
      ).resolves.toMatchObject({ changed: 0 });
    expect(started).toHaveLength(1);
  });

  it("leaves the pixels it is given as they were", async () => {
    const first = picture();
    const before = first.pixels.rgba.slice();

    await threads({ start: servedHere }).compare(
      first,
      picture([0, 0, 0]),
      size,
    );

    expect(first.pixels.rgba).toEqual(before);
  });

  it("ends the thread of a comparison that is stopped, and answers it as cancelled", async () => {
    const silent = workerRunning(
      "require('node:worker_threads').parentPort.on('message', () => {});",
    );
    const stop = new AbortController();
    const comparing = threads({ start: silent.start }).compare(
      picture(),
      picture(),
      size,
      stop.signal,
    );

    stop.abort();

    await expect(comparing).resolves.toBe("cancelled");
    await ended(silent.workers[0]!);
  });

  it("sends a comparison its stopped neighbour's thread held to a new thread, and answers it", async () => {
    const started: (ComparisonThread & { readonly ended: boolean })[] = [];
    const served = threads({
      start: () => {
        const thread = servedHere();
        started.push(thread);
        return thread;
      },
    });
    const stop = new AbortController();

    const stopped = served.compare(picture(), picture(), size, stop.signal);
    const kept = served.compare(picture(), picture([224, 16, 16]), size);
    stop.abort();

    await expect(stopped).resolves.toBe("cancelled");
    await expect(kept).resolves.toMatchObject({ areas: [expect.anything()] });
    expect(started).toHaveLength(2);
    expect(started[0]!.ended).toBe(true);
  });

  it("answers a comparison whose thread falls over as failed", async () => {
    const falling = workerRunning(
      "require('node:worker_threads').parentPort.on('message', () => { throw new Error('fell'); });",
    );

    await expect(
      threads({ start: falling.start }).compare(picture(), picture(), size),
    ).resolves.toBe("failed");
  });

  it("answers as failed when an answer from its thread cannot be read, and ends that thread", async () => {
    const listeners = new Map<string, (() => void)[]>();
    let ended = false;
    // A thread whose answer arrives unreadable.
    const garbled = {
      postMessage: () =>
        queueMicrotask(() =>
          listeners.get("messageerror")?.forEach((listen) => listen()),
        ),
      on: (event: string, listener: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      terminate: async () => {
        ended = true;
        return 0;
      },
      unref: () => undefined,
    } as unknown as ComparisonThread;

    await expect(
      threads({ start: () => garbled }).compare(picture(), picture(), size),
    ).resolves.toBe("failed");
    expect(ended).toBe(true);
  });

  it("answers as failed when no thread can start", async () => {
    await expect(
      threads({
        start: () => {
          throw new Error("No thread.");
        },
      }).compare(picture(), picture(), size),
    ).resolves.toBe("failed");
  });

  it("ends its thread once no comparison has been asked for a while", async () => {
    const started: (ComparisonThread & { readonly ended: boolean })[] = [];
    const served = threads({
      start: () => {
        const thread = servedHere();
        started.push(thread);
        return thread;
      },
      idleMs: 20,
    });

    await served.compare(picture(), picture(), size);
    expect(started[0]!.ended).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(started[0]!.ended).toBe(true);
    // A later comparison starts another.
    await expect(
      served.compare(picture(), picture(), size),
    ).resolves.toMatchObject({
      changed: 0,
    });
    expect(started).toHaveLength(2);
  });
});
