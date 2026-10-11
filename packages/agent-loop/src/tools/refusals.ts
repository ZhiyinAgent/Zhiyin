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

/**
 * A call to a tool that is not on offer. A name one or two keystrokes from an
 * offered one, or a remote tool's own name without its routing prefix, is
 * named as the one likely meant.
 */
export function unknownTool(name: string, offered: readonly string[]): Refusal {
  const near = closestName(name, offered);
  return refusal(
    "input-check",
    `The tool “${name}” is not available.${near ? ` The closest on offer is “${near}”.` : ""}`,
    "Use one of the tools on offer.",
  );
}

function closestName(
  name: string,
  offered: readonly string[],
): string | undefined {
  const allowed = Math.min(2, Math.floor(name.length / 4));
  let best: { readonly name: string; readonly distance: number } | undefined;
  for (const candidate of offered) {
    const prefix = candidate.lastIndexOf("__");
    const distance = Math.min(
      editDistance(name, candidate),
      prefix < 0 ? Infinity : editDistance(name, candidate.slice(prefix + 2)),
    );
    if (distance <= allowed && (!best || distance < best.distance))
      best = { name: candidate, distance };
  }
  return best?.name;
}

/** Characters inserted, removed or replaced to turn one name into the other. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1)
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length]!;
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
