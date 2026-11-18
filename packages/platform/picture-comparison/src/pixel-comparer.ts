/**
 * Two drawn pictures brought to one size and compared, and the sheet that
 * shows it, worked out on a thread of its own. At 640 pixels across this is
 * about two seconds of arithmetic on a desktop PC, more for larger pictures;
 * done where the app's core runs, every conversation and the window would wait
 * for it. A thread that is not needed for a minute ends,
 * and one whose comparison is stopped is ended at once, which stops the
 * arithmetic with it.
 */

import { comparisonSheet, sheetSize } from "./comparison-sheet.js";
import {
  differenceOf,
  resample,
  visibleDifference,
  type Difference,
  type Rect,
} from "./picture-difference.js";
import type { Pixels } from "./pixels.js";
import { encodePng } from "./png-encode.js";

/** What a comparison finds, with its sheet as a PNG. */
export type Comparison = Omit<Difference, "distance"> & {
  readonly sheet: Uint8Array;
};

/** A drawn picture, and the part of it that is compared. */
export type DrawnPart = { readonly pixels: Pixels; readonly rect: Rect };

/** The size both parts are compared at. */
export type ComparedSize = { readonly width: number; readonly height: number };

/** Where pixels are compared: on a thread in the app, here in tests. */
export type PixelComparer = {
  compare(
    first: DrawnPart,
    second: DrawnPart,
    size: ComparedSize,
    signal?: AbortSignal,
  ): Promise<Comparison | "cancelled" | "failed">;
};

/**
 * The sheet's largest size: under three and a half million bytes of raw
 * colour, so even a picture that does not compress travels under the five
 * megabytes a provider takes for one picture once it is encoded for sending.
 */
const sheetPixels = 1_150_000;
const sheetBytes = 3 * 1024 * 1024;
/** Panels are drawn at least this large on their long side, to be read. */
const panelAtLeast = 320;

/** The sheet as a PNG, made smaller until it is small enough to send. */
function sheetOf(
  first: Pixels,
  second: Pixels,
  difference: Difference,
): Uint8Array {
  const panels = {
    first,
    second,
    distance: difference.distance,
    visible: visibleDifference,
    areas: difference.areas,
  };
  const resize = (picture: Pixels, width: number, height: number) =>
    resample(
      picture,
      { x: 0, y: 0, width: picture.width, height: picture.height },
      width,
      height,
    );
  const pixelsAt = (scale: number) => {
    const size = sheetSize(first.width, first.height, scale);
    return size.width * size.height;
  };
  // Small pictures are drawn larger to be seen; then the largest scale whose
  // whole sheet, margins and labels included, fits.
  let scale = Math.max(1, panelAtLeast / Math.max(first.width, first.height));
  while (pixelsAt(scale) > sheetPixels && scale > 0.05) scale *= 0.98;
  let png = encodePng(comparisonSheet(panels, resize, scale));
  while (png.length > sheetBytes && scale > 0.3) {
    scale *= 0.8;
    png = encodePng(comparisonSheet(panels, resize, scale));
  }
  // A copy with memory of its own: a small Buffer shares Node's pool, which
  // handing it to another thread would take from everything else using it.
  return new Uint8Array(png);
}

/** Two drawn parts brought to one size and compared, with the sheet. */
function comparePixels(
  firstPart: DrawnPart,
  secondPart: DrawnPart,
  size: ComparedSize,
): Comparison {
  const first = resample(
    firstPart.pixels,
    firstPart.rect,
    size.width,
    size.height,
  );
  const second = resample(
    secondPart.pixels,
    secondPart.rect,
    size.width,
    size.height,
  );
  const difference = differenceOf(first, second);
  const sheet = sheetOf(first, second, difference);
  const { distance, ...found } = difference;
  void distance;
  return { ...found, sheet };
}

/** Here, in this thread: for tests and tools run on their own. */
export const comparedHere: PixelComparer = {
  async compare(first, second, size, signal) {
    if (signal?.aborted) return "cancelled";
    const found = comparePixels(first, second, size);
    return signal?.aborted ? "cancelled" : found;
  },
};

type Job = {
  readonly id: number;
  readonly first: DrawnPart;
  readonly second: DrawnPart;
  readonly size: ComparedSize;
};

type Answer =
  | { readonly id: number; readonly ok: true; readonly comparison: Comparison }
  | { readonly id: number; readonly ok: false };

/** A thread as the core speaks to it: a Node worker, however it was started. */
export type ComparisonThread = {
  postMessage(message: Job, transfer: ArrayBuffer[]): void;
  on(event: "message", listener: (answer: Answer) => void): unknown;
  on(event: "error" | "exit" | "messageerror", listener: () => void): unknown;
  terminate(): Promise<number>;
  unref(): void;
};

/** The thread's side: compares what it is sent, one job at a time. */
export function serveComparisons(port: {
  on(event: "message", listener: (job: Job) => void): unknown;
  postMessage(answer: Answer, transfer: ArrayBuffer[]): void;
}): void {
  port.on("message", (job) => {
    try {
      const comparison = comparePixels(job.first, job.second, job.size);
      port.postMessage({ id: job.id, ok: true, comparison }, [
        comparison.sheet.buffer as ArrayBuffer,
      ]);
    } catch {
      port.postMessage({ id: job.id, ok: false }, []);
    }
  });
}

/** How long a thread outlives its last comparison. */
const defaultIdleMs = 60_000;

/**
 * Comparisons on a thread, started on the first and ended once none has
 * been asked for a while. A comparison that is stopped ends its thread;
 * any others that thread held are sent again to a new one.
 */
export class ComparisonThreads implements PixelComparer {
  readonly #start: () => ComparisonThread;
  readonly #idleMs: number;
  #thread: ComparisonThread | undefined;
  #next = 0;
  readonly #waiting = new Map<
    number,
    {
      readonly job: Job;
      readonly answer: (found: Comparison | "cancelled" | "failed") => void;
    }
  >();
  #idle: NodeJS.Timeout | undefined;
  #closed = false;

  constructor(options: {
    readonly start: () => ComparisonThread;
    readonly idleMs?: number;
  }) {
    this.#start = options.start;
    this.#idleMs = options.idleMs ?? defaultIdleMs;
  }

  compare(
    first: DrawnPart,
    second: DrawnPart,
    size: ComparedSize,
    signal?: AbortSignal,
  ): Promise<Comparison | "cancelled" | "failed"> {
    if (signal?.aborted || this.#closed)
      return Promise.resolve(this.#closed ? "failed" : "cancelled");
    clearTimeout(this.#idle);
    const job: Job = { id: ++this.#next, first, second, size };
    return new Promise((resolve) => {
      const stop = () => {
        if (!this.#waiting.has(job.id)) return;
        this.#waiting.delete(job.id);
        resolve("cancelled");
        // The arithmetic stops with its thread; the rest go to a new one.
        this.#restart();
      };
      this.#waiting.set(job.id, {
        job,
        answer: (found) => {
          signal?.removeEventListener("abort", stop);
          resolve(found);
        },
      });
      signal?.addEventListener("abort", stop, { once: true });
      this.#send(job);
    });
  }

  /**
   * Ends the thread now, answering any comparison under way as failed; none
   * is compared after.
   */
  close(): void {
    this.#closed = true;
    clearTimeout(this.#idle);
    for (const { answer } of this.#waiting.values()) answer("failed");
    this.#waiting.clear();
    void this.#thread?.terminate();
    this.#thread = undefined;
  }

  #send(job: Job): void {
    const thread = this.#running();
    if (!thread) {
      this.#settle(job.id, "failed");
      return;
    }
    // Copies, handed over whole, so the caller's pixels stay theirs and a
    // job can be sent again to a new thread.
    const copy = (part: DrawnPart) => ({
      rect: part.rect,
      pixels: { ...part.pixels, rgba: Uint8Array.from(part.pixels.rgba) },
    });
    const first = copy(job.first);
    const second = copy(job.second);
    thread.postMessage({ id: job.id, first, second, size: job.size }, [
      first.pixels.rgba.buffer as ArrayBuffer,
      second.pixels.rgba.buffer as ArrayBuffer,
    ]);
  }

  #running(): ComparisonThread | undefined {
    if (this.#thread) return this.#thread;
    let thread: ComparisonThread;
    try {
      thread = this.#start();
    } catch {
      return undefined;
    }
    thread.unref();
    thread.on("message", (answer) => {
      this.#settle(answer.id, answer.ok ? answer.comparison : "failed");
    });
    const ended = () => {
      if (this.#thread !== thread) return;
      this.#thread = undefined;
      // A thread that fell over takes its comparisons with it.
      for (const id of [...this.#waiting.keys()]) this.#settle(id, "failed");
    };
    thread.on("error", ended);
    thread.on("exit", ended);
    // An answer that cannot be read names no comparison: the thread is
    // ended, and what it held with it.
    thread.on("messageerror", () => {
      if (this.#thread !== thread) return;
      ended();
      void thread.terminate();
    });
    this.#thread = thread;
    return thread;
  }

  #settle(id: number, found: Comparison | "cancelled" | "failed"): void {
    const waiting = this.#waiting.get(id);
    if (!waiting) return;
    this.#waiting.delete(id);
    waiting.answer(found);
    if (this.#waiting.size === 0 && !this.#closed) {
      clearTimeout(this.#idle);
      this.#idle = setTimeout(() => this.#rest(), this.#idleMs);
      this.#idle.unref();
    }
  }

  #restart(): void {
    const old = this.#thread;
    this.#thread = undefined;
    void old?.terminate();
    for (const { job } of this.#waiting.values()) this.#send(job);
  }

  #rest(): void {
    if (this.#waiting.size > 0) return;
    const old = this.#thread;
    this.#thread = undefined;
    void old?.terminate();
  }
}
