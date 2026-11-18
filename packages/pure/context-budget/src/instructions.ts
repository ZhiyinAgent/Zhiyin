/**
 * How much of one standing instruction's source the model is sent: what the
 * person asks of every conversation, and a folder's AGENTS.md. ADR 0016.
 */

import { bytesForTokens } from "./token-estimate.js";

/** The least of one source the model is sent, in estimated tokens. */
const leastInstructionTokens = 8_000;
/** The share of the budget one source may take, where that is more. */
const instructionShare = 0.05;
/** The largest budget there is, so the most any source is ever sent. */
const largestBudgetTokens = 1_000_000;

/**
 * How much of one source the model is sent under a budget of
 * `targetTokens`, in estimated tokens: its share of the budget, and never
 * less than the least. Counted in tokens rather than bytes, so a source
 * written in Chinese has the room the same meaning has in English.
 */
export function instructionTokens(targetTokens: number): number {
  return Math.max(
    leastInstructionTokens,
    Math.floor(targetTokens * instructionShare),
  );
}

/**
 * How much of a source a reader holds, in UTF-8 bytes: a little more than any
 * budget sends, so a source cut there is cut again where a paragraph ends.
 */
export const longestInstructionBytes =
  bytesForTokens(instructionTokens(largestBudgetTokens)) + 4;
