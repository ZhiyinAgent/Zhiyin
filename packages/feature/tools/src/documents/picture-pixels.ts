/**
 * Where a picture or a PDF page becomes pixels for the model's tools to work
 * on. Decoding runs native code on bytes nobody vouches for, so the app hands
 * in a source that decodes in a contained process (ADR 0019) and answers only
 * the pixels, which are counted and never decoded again. The tools hold no
 * decoder of their own: without a source, nothing is drawn.
 */

import type { Pixels } from "@zhiyin/picture-comparison";

export type PixelFormat = "picture" | "pdf";

export type OpenedPixels =
  | {
      readonly ok: true;
      /** Each page's size: a picture's pixels, a PDF page's at 96 per inch. */
      readonly pages: readonly {
        readonly width: number;
        readonly height: number;
      }[];
      /**
       * The page drawn on white that wide, never wider than a picture's own
       * pixels or twice a PDF page; or that drawing it took too long or its
       * process ended, and so was stopped; or that no process could start to
       * draw it; or nothing when it could not be drawn.
       */
      draw(
        page: number,
        width: number,
      ): Promise<Pixels | "stopped" | "unstartable" | undefined>;
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

export type PixelSource = {
  open(bytes: Uint8Array, format: PixelFormat): Promise<OpenedPixels>;
};
