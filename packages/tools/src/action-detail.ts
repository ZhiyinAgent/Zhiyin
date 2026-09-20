/**
 * Helpers for a tool describing its own answer in a shape a person can read.
 *
 * The bound is the point. A detail travels to the interface and into the saved
 * task, so it has to be a summary of an answer rather than the whole of one —
 * a two-megabyte file read is a legitimate result and an illegitimate thing to
 * carry twice. Where the text is cut, it says so, because a reader who cannot
 * tell a complete answer from a shortened one has been told something false.
 */

import type { ActionDetail } from "@zhiyin/contract";

/** Enough to read and judge by; not enough to be a second copy of the file. */
const maximumDetailCharacters = 8000;

export function textDetail(
  label: string,
  text: string,
  alreadyTruncated = false,
): ActionDetail | undefined {
  if (!text) return undefined;
  const cut = text.length > maximumDetailCharacters;
  return {
    kind: "text",
    label,
    text: cut ? text.slice(0, maximumDetailCharacters) : text,
    ...(cut || alreadyTruncated ? { truncated: true } : {}),
  };
}

export function facts(
  ...items: readonly (readonly [string, string | number | undefined])[]
): ActionDetail | undefined {
  const kept = items
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
  return kept.length ? { kind: "facts", items: kept } : undefined;
}

/**
 * Drops the gaps and spreads into a result, so a tool can offer a detail
 * conditionally without either ceremony or an explicit `undefined`.
 */
export function detailsOf(
  ...candidates: readonly (ActionDetail | undefined)[]
): { readonly details?: readonly ActionDetail[] } {
  const kept = candidates.filter(
    (candidate): candidate is ActionDetail => candidate !== undefined,
  );
  return kept.length ? { details: kept } : {};
}
