/**
 * What passes between the core and the process that draws. The document's
 * bytes go in once per revision. What comes back is plain data: page sizes, a
 * page as PNG or JPEG bytes, and a PDF page's text as strings, alone or with
 * the numbers that place each on the page. Nothing else
 * comes back, so nothing in a document can reach the core or the window by any
 * other route (ADR 0019). Pixels come back as the bytes of each one's red,
 * green, blue and opacity, which are counted and never decoded.
 */

import type { DocumentPageSize } from "@zhiyin/contract";

export type DrawingFormat = "pdf" | "picture" | "svg";

export type DrawingRequest =
  | {
      readonly id: number;
      readonly kind: "open";
      readonly revision: string;
      readonly format: DrawingFormat;
      readonly bytes: Uint8Array;
    }
  | {
      readonly id: number;
      readonly kind: "draw";
      readonly revision: string;
      /** Counting from 1. */
      readonly page: number;
      /** In device pixels; the service draws no wider than twice the page. */
      readonly width: number;
      /**
       * A picture drawn with its transparency kept, rather than on the white
       * a page is drawn on: for the model, which is sent what the file holds.
       */
      readonly transparent?: true;
      /**
       * The page as its pixels rather than a PNG, for the model's tools to
       * compare without decoding anything the process made.
       */
      readonly pixels?: true;
    }
  | {
      readonly id: number;
      readonly kind: "release";
      readonly revision: string;
    }
  /** The text items on a PDF page, for the model (ADR 0019). */
  | {
      readonly id: number;
      readonly kind: "text";
      readonly revision: string;
      readonly page: number;
    }
  /** A PDF page as a JPEG at a scale of its points, for the model (ADR 0019). */
  | {
      readonly id: number;
      readonly kind: "picture";
      readonly revision: string;
      readonly page: number;
      readonly scale: number;
      readonly quality: number;
    }
  /**
   * The text items on a PDF page with where each is drawn, and the page's
   * box, for finding text at a compiled page's edge (ADR 0019).
   */
  | {
      readonly id: number;
      readonly kind: "placed";
      readonly revision: string;
      readonly page: number;
    };

/** One item of a PDF page's text, with where pdf.js says it is drawn. */
export type PlacedText = {
  readonly text: string;
  /** The item's matrix: `a b c d e f`, in points from the page's origin. */
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
  /** Its font's reach above and below the baseline, in ems, when known. */
  readonly ascent?: number;
  readonly descent?: number;
};

export type DrawingFailure =
  "damaged" | "protected" | "no-such-page" | "not-open" | "failed";

export type DrawingReply =
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: "opened";
      readonly pages: readonly DocumentPageSize[];
    }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: "drawn";
      readonly png: Uint8Array;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: "pixels";
      /** Four bytes a pixel, row by row: red, green, blue and opacity. */
      readonly rgba: Uint8Array;
      readonly width: number;
      readonly height: number;
    }
  | { readonly id: number; readonly ok: true; readonly kind: "released" }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: "text";
      readonly strings: readonly string[];
    }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: "picture";
      readonly jpeg: Uint8Array;
    }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: "placed";
      /** The page's box: left, bottom, right and top, in points. */
      readonly view: readonly number[];
      readonly items: readonly PlacedText[];
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly failure: DrawingFailure;
    };

/** The service's side of the conversation, whatever carries it. */
export type DrawingPort = {
  receive(handler: (request: DrawingRequest) => void): void;
  send(reply: DrawingReply): void;
};
