/**
 * How much of a model's window a conversation may fill before it is condensed.
 * The person trades detail for cost: every request pays for all it carries.
 * The formulas are the context-budget package's (ADR 0002).
 */

export type ContextBudgetChoice = "low" | "medium" | "ultra";

/** What a model lists about its size; each part absent when it does not say. */
export type ModelWindow = {
  readonly contextWindow?: number;
  readonly maximumOutputTokens?: number;
  /**
   * Earlier turns go back to this provider with their reasoning, which then
   * counts toward each request's size.
   */
  readonly reasoningSentBack?: boolean;
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

/**
 * Model-facing context before this exact message is represented by a summary.
 * The messages themselves remain the durable human transcript.
 */
type TaskCompaction = {
  readonly revision: number;
  readonly throughMessageId: string;
  /** The last history entry condensed, which may fall between rounds of one turn. */
  readonly throughEntryId: string;
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
 * One attempt to condense a conversation, placed where it began: what is sent
 * while it runs shares its place and comes after it. A failed one is not tried
 * again until the request grows by a tenth past `tokensBefore`, unless the
 * target changes; one that left the request still past its target, not until
 * it grows past `tokensAfter`. One the person stopped with its turn is not
 * recorded.
 */
export type TaskCondensing = {
  readonly id: string;
  readonly sequence: number;
  readonly createdAt: string;
  /** The target the request was held to when it was tried. */
  readonly targetTokens: number;
  readonly tokensBefore: number;
  /** Made because the provider refused the request as too long. */
  readonly afterRefusal?: true;
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
  /** Each attempt to condense it, in its place in the conversation. */
  readonly condensings: readonly TaskCondensing[];
};
