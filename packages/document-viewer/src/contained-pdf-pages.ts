/**
 * PDF pages read for the model in a contained process, as the panel's pages
 * are drawn in one (ADR 0023): a document that hangs pdf.js or
 * faults the canvas costs one answer and its process, never the core.
 *
 * One process serves every conversation's reads. It is started on the first
 * read and ended once nothing has been read for a while, so a run of reads
 * does not pay for starting one each time, and an idle app holds none. A read
 * left open longer has its document given to the next process.
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
  readonly #options: ConstructorParameters<typeof DrawingHost>[0];
  #host: DrawingHost | undefined;

  constructor(options: {
    readonly start: StartDrawingProcess;
    readonly containment: DrawingContainment;
    readonly timeoutMs?: number;
    /** How long the process outlives the last request; a minute by default. */
    readonly idleMs?: number;
  }) {
    this.#options = options;
  }

  async open(bytes: Uint8Array): Promise<ContainedPdf> {
    const host = (this.#host ??= new DrawingHost(this.#options));
    // Its own name for each read: two reads of the same bytes never let go
    // of each other's document.
    const revision = randomUUID();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      void host.release(revision);
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
    this.#host?.close();
    this.#host = undefined;
  }
}
