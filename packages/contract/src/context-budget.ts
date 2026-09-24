/**
 * How much of a model's window a conversation may fill before it is condensed.
 * The person trades detail for cost: every request pays for all it carries.
 */

export type ContextBudgetChoice = "low" | "medium" | "ultra";

/** What a model lists about its size; each part absent when it does not say. */
export type ModelWindow = {
  readonly contextWindow?: number;
  readonly maximumOutputTokens?: number;
};

/**
 * How full the last request was, part by part, as the loop sent it. The parts
 * are estimates; the total is the provider's own count when it gave one, with
 * only what was added since estimated.
 */
export type ContextUsage = {
  readonly model: string;
  readonly totalTokens: number;
  readonly measured: boolean;
  readonly parts: {
    readonly instructions: number;
    readonly tools: number;
    readonly summary: number;
    readonly conversation: number;
    readonly toolResults: number;
  };
};

export type ContextBudgetOption = {
  readonly budget: ContextBudgetChoice;
  readonly targetTokens: number;
};

/** A window Zhiyin is built for at the least, assumed when a model's is unknown. */
const smallestWindow = 128_000;
/** Below this window Ultra buys nothing Medium does not, so it is not offered. */
const ultraFrom = 300_000;
const replyReserve = 16_000;
const margin = 0.05;

/** Each budget's share of the window and its ceiling, by window size. */
function shares(window: number) {
  return window >= ultraFrom
    ? ([
        ["low", 0.5, 128_000],
        ["medium", 0.75, 262_000],
        ["ultra", 0.85, 1_000_000],
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
export const fixedShare = 0.15;

/**
 * The longest message a person sends as text, about 17k tokens: a third of
 * the smallest budget's condensed request, so the latest message always fits
 * beside what condensing keeps. Anything longer is sent as a file the model
 * reads in parts, as a long paste is.
 */
export const typedMessageCharacters = 50_000;

/** Whether the fixed start of the last request leaves room under `target`. */
export function fixedPartFits(usage: ContextUsage, targetTokens: number) {
  return (
    usage.parts.instructions + usage.parts.tools <= targetTokens * fixedShare
  );
}

/**
 * Model-facing context before this exact message is represented by a summary.
 * The messages themselves remain the durable human transcript.
 */
export type TaskCompaction = {
  readonly revision: number;
  readonly throughMessageId: string;
  /**
   * The last history entry condensed, when the cut fell between rounds of one
   * turn rather than after a message. Absent in older history.
   */
  readonly throughEntryId?: string;
  readonly summary: string;
  /** What Zhiyin carried over word for word beside the model's summary. */
  readonly carried?: string;
  readonly retainedActionIds: readonly string[];
  readonly createdAt: string;
};

/**
 * Why a condensing changed nothing: only the newest round was left to keep;
 * no part of the conversation fits the model's window; the request to the
 * model failed; or its answer was not a usable summary.
 */
export type CondensingFailure =
  "nothing-to-condense" | "too-large" | "request-failed" | "unusable";

/**
 * One attempt to condense a conversation, placed where it happened. A failed
 * one is not tried again until the request grows by a tenth past
 * `tokensBefore`, unless the target changes; one that left the request still
 * past its target, not until it grows past `tokensAfter`. One the person
 * stopped with its turn is not recorded.
 */
export type TaskCondensing = {
  readonly id: string;
  readonly sequence: number;
  readonly createdAt: string;
  /** The target the request was held to when it was tried. */
  readonly targetTokens: number;
  readonly tokensBefore: number;
} & (
  | {
      readonly outcome: "condensed";
      /** The compaction revision it wrote, and the last message it covered. */
      readonly revision: number;
      readonly throughMessageId: string;
      readonly tokensAfter: number;
      /** The person's and the model's messages, and the tool calls, summarised. */
      readonly messages: number;
      readonly actions: number;
      /** The model's summary, in Markdown, and what Zhiyin carried beside it. */
      readonly summary: string;
      readonly carried?: string;
      /** The files read again after it, as they were then. */
      readonly reread?: readonly string[];
      readonly reason?: undefined;
    }
  | {
      readonly outcome: "failed";
      readonly reason: CondensingFailure;
      /** The provider's own words, for a request that failed. */
      readonly detail?: string;
    }
);

/** How a conversation is kept within its budget, as saved with it. */
export type TaskContext = {
  /** Absent follows the app's default. */
  readonly contextBudget?: ContextBudgetChoice;
  /** How full the last request was; absent until one is sent. */
  readonly contextUsage?: ContextUsage;
  readonly compaction?: TaskCompaction;
  /** Each attempt to condense it, where it happened. Absent before the first. */
  readonly condensings?: readonly TaskCondensing[];
};
