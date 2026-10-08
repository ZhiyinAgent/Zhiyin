/**
 * What passes between the core and the process that draws. The document's
 * bytes go in once per revision. What comes back is plain data: page sizes, a
 * page as PNG or JPEG bytes, and a PDF page's text as strings. Nothing else
 * comes back, so nothing in a document can reach the core or the window by any
 * other route (ADR 0018).
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
    }
  | {
      readonly id: number;
      readonly kind: "release";
      readonly revision: string;
    }
  /** The text items on a PDF page, for the model (ADR 0018). */
  | {
      readonly id: number;
      readonly kind: "text";
      readonly revision: string;
      readonly page: number;
    }
  /** A PDF page as a JPEG at a scale of its points, for the model (ADR 0018). */
  | {
      readonly id: number;
      readonly kind: "picture";
      readonly revision: string;
      readonly page: number;
      readonly scale: number;
      readonly quality: number;
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
      readonly ok: false;
      readonly failure: DrawingFailure;
    };

/** The service's side of the conversation, whatever carries it. */
export type DrawingPort = {
  receive(handler: (request: DrawingRequest) => void): void;
  send(reply: DrawingReply): void;
};
