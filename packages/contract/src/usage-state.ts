import type { EstimatedCost, MoneyAmount } from "./models.js";

/**
 * Costs estimated from price lists where providers reported none, added up
 * in each currency apart, by currency code. Absent when none was estimated.
 */
type Estimated = {
  readonly estimatedCosts?: readonly MoneyAmount[];
};

/**
 * `costUsd` is what providers reported, in US dollars. A request is priced
 * when its cost was reported or estimated.
 */
export type UsageRange = Estimated & {
  readonly days: 7 | 30;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly pricedRequests: number;
  readonly activity: readonly (Estimated & {
    readonly date: string;
    readonly requests: number;
    readonly costUsd: number;
  })[];
  readonly models: readonly (Estimated & {
    readonly model: string;
    readonly requests: number;
    /** Requests a cost was reported or estimated for. */
    readonly pricedRequests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  })[];
  /**
   * What each conversation cost in the range, the costliest first. One with
   * no `conversationId` holds the requests made outside any conversation.
   */
  readonly conversations: readonly (Estimated & {
    readonly conversationId?: string;
    readonly requests: number;
    readonly pricedRequests: number;
    readonly costUsd: number;
  })[];
};

/** What a model request was made for. */
export type UsagePurpose = "turn" | "condensing" | "specialist" | "background";

/**
 * `unavailable` is usage not recorded yet; `failed` is a usage history that
 * could not be read or saved.
 */
export type UsageState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string }
  | {
      readonly status: "ready";
      readonly ranges: {
        readonly "7": UsageRange;
        readonly "30": UsageRange;
      };
    };

export type ProviderUsage = {
  readonly requestId: string;
  readonly model: string;
  /** The upstream that served it, when the provider said. */
  readonly provider?: string;
  /** The conversation it was made for; absent outside any conversation. */
  readonly conversationId?: string;
  readonly purpose?: UsagePurpose;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** What the provider reported it cost, in US dollars. */
  readonly costUsd?: number;
  /** Where it reported none: what it cost by the shipped price list. */
  readonly estimatedCost?: EstimatedCost;
  /** Of the input, what the provider read from and wrote to its cache. */
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  /** Of the output, what the model spent reasoning, when it said. */
  readonly reasoningTokens?: number;
  readonly recordedAt: string;
};
