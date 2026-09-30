/**
 * The one shape of a refusal the model receives: who refused, what happened,
 * and what it can do next.
 *
 * A bare reason leaves the model to guess whether to fix its call, try
 * something else, or stop; it guesses by retrying. Saying who refused tells it
 * which of those is open, and the next step names one. The person reads the
 * same `reason` in the action row, so the two accounts agree.
 */

import type { ToolInvocationResult } from "@zhiyin/contract";

export type RefusedBy =
  "person" | "permission" | "safety" | "input-check" | "tool" | "provider";

export type Refusal = Extract<ToolInvocationResult, { readonly ok: false }> & {
  readonly refusedBy: RefusedBy;
  readonly next: string;
};

export function refusal(
  refusedBy: RefusedBy,
  reason: string,
  next: string,
): Refusal {
  return { ok: false, refusedBy, reason, next };
}

/** A call whose input could not be read as one JSON object. */
export function unreadableInput(reason: string, cutOff: boolean): Refusal {
  return refusal(
    "input-check",
    reason,
    cutOff
      ? "Send shorter content, or split the write into several calls."
      : "Send the call again with its arguments as one JSON object, with quotes and line breaks inside text escaped.",
  );
}

/** A tool refused the call, and said the model can put it right. */
export function correctableByModel(reason: string): Refusal {
  return refusal(
    "tool",
    reason,
    "Correct the call from what the tool said and send it again.",
  );
}

/** Later calls in a batch cannot run against assumptions denied by the person. */
export function skippedAfterDecline(): Refusal {
  return refusal(
    "person",
    "Not run because the person declined an earlier action in this batch.",
    "Review the person's guidance before proposing further actions.",
  );
}
