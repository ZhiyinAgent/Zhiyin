/**
 * A failure whose message is meant for the person, wherever it was raised. It
 * crosses a boundary — the core's workspace to a turn, say — and whoever ends
 * the work recognises it, so the two sides agree on a type rather than on the
 * spelling of a name.
 */
export class VisibleError extends Error {
  override name = "VisibleError";
}
