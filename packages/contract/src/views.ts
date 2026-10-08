/**
 * What a view is made of. A view is stored and restored as its source, never as
 * a picture, because the conversation outlives any one render (ADR 0003).
 */
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
};

/**
 * The answer. `reason` is the drawing library's own complaint, kept for the
 * repair model to work from — it is never shown to a person, who should see
 * either a view or nothing about it.
 */
export type ViewCheckOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };
