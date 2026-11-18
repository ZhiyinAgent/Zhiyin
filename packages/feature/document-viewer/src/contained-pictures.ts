/**
 * Pictures made smaller for the model, and pictures and PDF pages drawn to
 * pixels for its tools to compare, in a contained process, as PDF pages are
 * read in one (ADR 0019): a picture that faults a decoder or takes more memory
 * than allowed costs that picture and its process, never the core.
 *
 * Its process is started on the first picture and ended once none has been
 * asked for a while.
 */

import { randomUUID } from "node:crypto";
import type { DocumentPageSize } from "@zhiyin/contract";
import type { DrawingFormat } from "./drawing-protocol.js";
import {
  DrawingHost,
  type DrawingContainment,
  type StartDrawingProcess,
} from "./drawing-host.js";

export type SmallerPicture = {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
};

/** A page's pixels: four bytes each, row by row, red, green, blue, opacity. */
export type DrawnPixels = {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
};

export type OpenedPixels =
  | {
      readonly ok: true;
      /** Each page's size: a picture's pixels, a PDF page's at 96 per inch. */
      readonly pages: readonly DocumentPageSize[];
      /**
       * The page drawn that wide; or that drawing it took too long or its
       * process ended, and so was stopped; or that no process could start to
       * draw it; or nothing when it could not be drawn.
       */
      draw(
        page: number,
        width: number,
      ): Promise<DrawnPixels | "stopped" | "unstartable" | undefined>;
      close(): void;
    }
  | {
      readonly ok: false;
      /**
       * No process could start; the bytes are not a picture it can open; or
       * opening took too long, or its process ended, and so was stopped.
       */
      readonly failure: "unstartable" | "unopenable" | "stopped";
    };

/** The widest page the service draws: twice a PDF page at its widest bound. */
const widestDrawn = 8000;

/**
 * Pixels whose count matches their size, no wider than was asked and of the
 * page's shape: a process that went wrong cannot hand the tools a picture
 * larger than they asked for, or bytes that do not make up the picture they
 * claim to.
 */
function wholePixels(
  reply: DrawnPixels,
  asked: number,
  page: DocumentPageSize,
): boolean {
  const { width, height, rgba } = reply;
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= Math.max(1, Math.round(asked)) &&
    width <= widestDrawn &&
    height <= widestDrawn &&
    // Page sizes are whole pixels, so a drawn page's shape is near theirs.
    Math.abs(height - (width * page.height) / page.width) <=
      Math.max(2, height * 0.01) &&
    rgba instanceof Uint8Array &&
    rgba.length === width * height * 4
  );
}

export class ContainedPictures {
  readonly #options: ConstructorParameters<typeof DrawingHost>[0];
  #host: DrawingHost | undefined;

  constructor(options: {
    readonly start: StartDrawingProcess;
    readonly containment: DrawingContainment;
    readonly timeoutMs?: number;
    readonly processMemoryLimit?: number;
    /** How long the process outlives the last request; a minute by default. */
    readonly idleMs?: number;
  }) {
    this.#options = options;
  }

  /**
   * The picture drawn `width` pixels wide as a PNG, its transparency kept,
   * never wider than its own pixels or 2,000, or nothing when it could not be
   * decoded or drawn.
   */
  async smaller(
    bytes: Uint8Array,
    width: number,
  ): Promise<SmallerPicture | undefined> {
    const host = (this.#host ??= new DrawingHost(this.#options));
    const revision = randomUUID();
    try {
      const opened = await host.open(revision, "picture", bytes);
      if (!opened.ok || opened.kind !== "opened") return undefined;
      const drawn = await host.draw(revision, 1, width, { transparent: true });
      return drawn.ok && drawn.kind === "drawn"
        ? { png: drawn.png, width: drawn.width, height: drawn.height }
        : undefined;
    } finally {
      void host.release(revision);
    }
  }

  /**
   * A picture, an SVG drawing or a PDF opened for its pixels, for the model's
   * tools to compare. Each page is drawn on white at the width asked, never
   * wider than a picture's own pixels or twice a PDF page, and comes back as
   * its pixels, which are only counted here: nothing the process made is
   * decoded in the core.
   */
  async open(bytes: Uint8Array, format: DrawingFormat): Promise<OpenedPixels> {
    const host = (this.#host ??= new DrawingHost(this.#options));
    const revision = randomUUID();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      void host.release(revision);
    };
    const opened = await host.open(revision, format, bytes);
    if (!opened.ok || opened.kind !== "opened") {
      close();
      return {
        ok: false,
        failure: opened.ok
          ? "unopenable"
          : opened.failure === "uncontained"
            ? "unstartable"
            : opened.failure === "timed-out" ||
                opened.failure === "ended" ||
                opened.failure === "unsent"
              ? "stopped"
              : "unopenable",
      };
    }
    return {
      ok: true,
      pages: opened.pages,
      draw: async (page, width) => {
        const size = opened.pages[page - 1];
        if (!size) return undefined;
        const reply = await host.draw(revision, page, width, { pixels: true });
        if (!reply.ok)
          return reply.failure === "uncontained"
            ? "unstartable"
            : reply.failure === "timed-out" ||
                reply.failure === "ended" ||
                reply.failure === "unsent"
              ? "stopped"
              : undefined;
        if (reply.kind !== "pixels") return undefined;
        return wholePixels(reply, width, size) ? reply : undefined;
      },
      close,
    };
  }

  /** Ends the process now; a later picture starts another. */
  close(): void {
    this.#host?.close();
    this.#host = undefined;
  }
}
