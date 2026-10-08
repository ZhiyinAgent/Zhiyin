/**
 * PDF pages read for the model in a contained process, as the panel's pages
 * are drawn in one (ADR 0018): a document that hangs pdf.js or
 * faults the canvas costs one answer and its process, never the core.
 *
 * One process serves every conversation's reads. It is started on the first
 * read and ended once nothing has been read for a while, so a run of reads
 * does not pay for starting one each time, and an idle app holds none.
 */

import { randomUUID } from "node:crypto";
import type { DocumentPageSize } from "@zhiyin/contract";
import {
  DrawingHost,
  type DrawingContainment,
  type StartDrawingProcess,
} from "./drawing-host.js";

/** A PDF point is 1/72 inch; the host answers in CSS pixels, 1/96. */
const pointsPerCssPixel = 72 / 96;
/** How long the process outlives the last read. */
const defaultIdleMs = 60_000;

export type ContainedPdf =
  | {
      readonly ok: true;
      /** Each page's size in points. */
      readonly pages: readonly DocumentPageSize[];
      /** The page's text items, or nothing when they could not be read. */
      text(page: number): Promise<readonly string[] | undefined>;
      /** The page as a JPEG, or nothing when it could not be drawn. */
      picture(
        page: number,
        scale: number,
        quality: number,
      ): Promise<Uint8Array | undefined>;
      close(): void;
    }
  | { readonly ok: false; readonly failure: "unstartable" | "unopenable" };

export class ContainedPdfPages {
  readonly #options: {
    readonly start: StartDrawingProcess;
    readonly containment: DrawingContainment;
    readonly timeoutMs?: number;
  };
  readonly #idleMs: number;
  #host: DrawingHost | undefined;
  #reading = 0;
  #idle: NodeJS.Timeout | undefined;

  constructor(options: {
    readonly start: StartDrawingProcess;
    readonly containment: DrawingContainment;
    readonly timeoutMs?: number;
    readonly idleMs?: number;
  }) {
    this.#options = {
      start: options.start,
      containment: options.containment,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    };
    this.#idleMs = options.idleMs ?? defaultIdleMs;
  }

  async open(bytes: Uint8Array): Promise<ContainedPdf> {
    clearTimeout(this.#idle);
    this.#reading += 1;
    const host = (this.#host ??= new DrawingHost(this.#options));
    // Its own name for each read: two reads of the same bytes never let go
    // of each other's document.
    const revision = randomUUID();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      void host.release(revision);
      this.#done();
    };
    const opened = await host.open(revision, "pdf", bytes);
    if (!opened.ok || opened.kind !== "opened") {
      close();
      return {
        ok: false,
        failure:
          !opened.ok && opened.failure === "uncontained"
            ? "unstartable"
            : "unopenable",
      };
    }
    return {
      ok: true,
      pages: opened.pages.map((page) => ({
        width: page.width * pointsPerCssPixel,
        height: page.height * pointsPerCssPixel,
      })),
      text: async (page) => {
        const reply = await host.text(revision, page);
        return reply.ok && reply.kind === "text" ? reply.strings : undefined;
      },
      picture: async (page, scale, quality) => {
        const reply = await host.picture(revision, page, scale, quality);
        return reply.ok && reply.kind === "picture" ? reply.jpeg : undefined;
      },
      close,
    };
  }

  /**
   * The words of each page, in order, or nothing when the document cannot be
   * opened or a page cannot be read.
   */
  async words(bytes: Uint8Array): Promise<readonly string[] | undefined> {
    const opened = await this.open(bytes);
    if (!opened.ok) return undefined;
    try {
      const pages: string[] = [];
      for (let page = 1; page <= opened.pages.length; page += 1) {
        const items = await opened.text(page);
        if (!items) return undefined;
        pages.push(items.join(""));
      }
      return pages;
    } finally {
      opened.close();
    }
  }

  /** Ends the process now; a later read starts another. */
  close(): void {
    clearTimeout(this.#idle);
    this.#host?.close();
    this.#host = undefined;
  }

  #done(): void {
    this.#reading -= 1;
    if (this.#reading > 0) return;
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => {
      if (this.#reading === 0) this.close();
    }, this.#idleMs);
    // Waiting to end a process never keeps the app running.
    this.#idle.unref();
  }
}
