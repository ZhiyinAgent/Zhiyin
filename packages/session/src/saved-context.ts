/**
 * What a conversation keeps about the size of its requests: the budget it is
 * held to, the size last measured, and each attempt to condense it.
 */

import { isRecord, optionalText, validSequence } from "./saved-values.js";

/** Absent, or one of the budgets; absent follows the default. */
export function validContextBudget(value: unknown): boolean {
  return (
    value === undefined ||
    value === "low" ||
    value === "medium" ||
    value === "ultra"
  );
}

/** Absent, or a measured size with its parts. */
export function validContextUsage(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.totalTokens === "number" &&
      isRecord(value.parts))
  );
}

const condensingFailures = new Set([
  "nothing-to-condense",
  "too-large",
  "request-failed",
  "unusable",
]);

/** One attempt to condense: where it happened, the sizes, and how it ended. */
export function validCondensing(value: unknown): boolean {
  const count = (tokens: unknown) =>
    typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0;
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sequence === "number" &&
    validSequence(value.sequence) &&
    typeof value.createdAt === "string" &&
    count(value.targetTokens) &&
    count(value.tokensBefore) &&
    (value.outcome === "condensed"
      ? count(value.revision) &&
        typeof value.throughMessageId === "string" &&
        count(value.tokensAfter) &&
        count(value.messages) &&
        count(value.actions) &&
        typeof value.summary === "string" &&
        optionalText(value.carried) &&
        (value.reread === undefined ||
          (Array.isArray(value.reread) &&
            value.reread.every((path) => typeof path === "string"))) &&
        value.reason === undefined
      : value.outcome === "failed" &&
        condensingFailures.has(String(value.reason)) &&
        optionalText(value.detail))
  );
}
