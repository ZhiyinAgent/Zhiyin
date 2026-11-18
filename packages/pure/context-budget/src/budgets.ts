/**
 * How much of a model's window a conversation may fill before it is condensed.
 * The person trades detail for cost: every request pays for all it carries.
 */

import type {
  ContextBudgetChoice,
  ContextBudgetOption,
  ContextUsage,
  ModelWindow,
} from "@zhiyin/contract";
import { bytesForTokens } from "./token-estimate.js";

/** A window Zhiyin is built for at the least, assumed when a model's is unknown. */
const smallestWindow = 128_000;
/** Below this window Ultra buys nothing Medium does not, so it is not offered. */
const ultraFrom = 300_000;
/** The largest budget there is: Ultra's ceiling. */
const ultraCeiling = 1_000_000;
const replyReserve = 16_000;
const margin = 0.05;

/** Each budget's share of the window and its ceiling, by window size. */
function shares(window: number) {
  return window >= ultraFrom
    ? ([
        ["low", 0.5, 128_000],
        ["medium", 0.75, 262_000],
        ["ultra", 0.85, ultraCeiling],
      ] as const)
    : ([
        ["low", 0.75, 128_000],
        ["medium", 0.85, 262_000],
      ] as const);
}

/**
 * The budgets a model offers, each with the size a request is kept under:
 * its share of the window up to a ceiling, and never past the window less
 * room for the reply and a margin.
 */
export function contextBudgets(model: ModelWindow): ContextBudgetOption[] {
  const window = model.contextWindow ?? smallestWindow;
  const reply = Math.min(
    model.maximumOutputTokens ?? replyReserve,
    replyReserve,
  );
  const room = window - reply - window * margin;
  return shares(window).map(([budget, share, ceiling]) => ({
    budget,
    targetTokens: Math.floor(Math.min(ceiling, window * share, room)),
  }));
}

/** The person's choice on this model; Ultra where it is not offered is Medium. */
export function contextTarget(
  choice: ContextBudgetChoice,
  model: ModelWindow,
): ContextBudgetOption {
  const options = contextBudgets(model);
  return (
    options.find((option) => option.budget === choice) ??
    options.find((option) => option.budget === "medium")!
  );
}

/**
 * The share of the budget the fixed start of every request — instructions and
 * tool definitions — may take. Past it, what condensing keeps is no longer sure
 * to fit, which the person is told when choosing a budget, never mid-task.
 */
const fixedShare = 0.15;

/** The share of the budget the person's latest request is kept whole in. */
const latestRequestShare = 0.1;

/**
 * The most estimated tokens a message a person sends as text may take under a
 * budget of `targetTokens`: the share condensing keeps whole for the latest
 * request, so it always fits beside what condensing keeps, and means as much
 * in Chinese as in English. Anything longer is sent as a file the model reads
 * in parts, as a long paste is.
 */
export function typedMessageTokens(targetTokens: number): number {
  return Math.floor(targetTokens * latestRequestShare);
}

/**
 * The most characters a message sent as text may have under any budget: one
 * of plain ASCII, at three characters an estimated token, under the largest.
 */
export const longestTypedMessage = bytesForTokens(
  typedMessageTokens(ultraCeiling),
);

/** Whether the fixed start of the last request leaves room under `target`. */
export function fixedPartFits(usage: ContextUsage, targetTokens: number) {
  return (
    usage.parts.instructions + usage.parts.tools <= targetTokens * fixedShare
  );
}
