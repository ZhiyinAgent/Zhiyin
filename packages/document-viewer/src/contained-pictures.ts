/**
 * Pictures made smaller for the model in a contained process, as PDF pages are
 * read in one (ADR 0023): a picture that faults a decoder or takes more memory
 * than allowed costs that picture and its process, never the core.
 *
 * Its process is started on the first picture and ended once none has been
 * asked for a while.
 */

import { randomUUID } from "node:crypto";
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

  /** Ends the process now; a later picture starts another. */
  close(): void {
    this.#host?.close();
    this.#host = undefined;
  }
}
