/**
 * What a view is made of. A view is stored and restored as its source, never as
 * a picture, because the conversation outlives any one render (ADR 0003).
 */

import type { ProducedImage } from "./pictures.js";

export const viewKinds = [
  "diagram",
  "bar-chart",
  "line-chart",
  "scatter-plot",
  "histogram",
  "box-plot",
] as const;

export type ViewKind = (typeof viewKinds)[number];

export type ProducedView = {
  readonly kind: ViewKind;
  readonly title: string;
  /** Mermaid for diagrams; normalized JSON for charts. */
  readonly source: string;
  /** A workspace path ending in .svg the drawing is saved to, through write_file (ADR 0003). */
  readonly saveTo?: string;
};

export type TaskView = ProducedView & {
  readonly id: string;
  readonly callId: string;
  readonly sequence: number;
};

/**
 * The core asking the surface that draws views whether it can draw one. This is
 * the only question that travels core-first and waits for an answer; everything
 * else the core sends is a notification.
 */
export type ViewCheckRequest = {
  readonly id: string;
  readonly kind: ViewKind;
  readonly source: string;
  /** The drawing is wanted as a file too, as the person's Save writes it. */
  readonly file?: true;
};

/**
 * What the window decided when it drew a view, for the model that asked for
 * it: the axes it chose, the bins it made, the names it cut short, and a
 * picture of the drawing for a model that takes pictures.
 */
export type DrawnView = {
  /** One sentence each. */
  readonly facts: readonly string[];
  /** The view as drawn, a PNG. */
  readonly picture?: ProducedImage;
  /** The drawing as the person's Save writes it, a standalone SVG, when asked for. */
  readonly svg?: string;
};

/**
 * The answer. `reason` is the drawing library's own complaint, which the
 * model is told, or that the window did not answer in time.
 */
export type ViewCheckOutcome =
  | {
      readonly ok: true;
      /** Absent when drawing it failed or took too long; it was still checked. */
      readonly drawn?: DrawnView;
    }
  | { readonly ok: false; readonly reason: string };
