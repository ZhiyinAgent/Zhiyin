/**
 * What a conversation keeps about the size of its requests: the budget it is
 * held to, the size last measured, and each attempt to condense it.
 */

import {
  oneOf,
  type CondensingFailure,
  type ContextBudgetChoice,
} from "@zhiyin/contract";
import { isRecord, optionalText, validSequence } from "./saved-values.js";

const budget = oneOf<ContextBudgetChoice>({
  low: true,
  medium: true,
  ultra: true,
});

/** Absent, or one of the budgets; absent follows the default. */
export function validContextBudget(value: unknown): boolean {
  return value === undefined || budget(value);
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

const condensingFailure = oneOf<CondensingFailure>({
  "nothing-to-condense": true,
  "too-large": true,
  "request-failed": true,
  unusable: true,
});

/** One attempt to condense: where it happened, the sizes, and how it ended. */
export function validCondensing(value: unknown): boolean {
  const count = (tokens: unknown) =>
    typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0;
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    validSequence(value.sequence) &&
    typeof value.createdAt === "string" &&
    count(value.targetTokens) &&
    count(value.tokensBefore) &&
    (value.afterRefusal === undefined || value.afterRefusal === true) &&
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
        condensingFailure(value.reason) &&
        optionalText(value.detail))
  );
}
