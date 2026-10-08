export type UsageRange = {
  readonly days: 7 | 30;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly pricedRequests: number;
  readonly activity: readonly {
    readonly date: string;
    readonly requests: number;
    readonly costUsd: number;
  }[];
  readonly models: readonly {
    readonly model: string;
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  }[];
  /**
   * What each conversation cost in the range, the costliest first. One with
   * no `conversationId` holds the requests made outside any conversation.
   */
  readonly conversations: readonly {
    readonly conversationId?: string;
    readonly requests: number;
    readonly pricedRequests: number;
    readonly costUsd: number;
  }[];
};

/** What a model request was made for. */
export type UsagePurpose = "turn" | "condensing" | "specialist" | "background";

export type UsageState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable"; readonly reason: string }
  | {
      readonly status: "ready";
      readonly costSource: "provider-reported";
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
  readonly costUsd?: number;
  /** Of the input, what the provider read from and wrote to its cache. */
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  /** Of the output, what the model spent reasoning, when it said. */
  readonly reasoningTokens?: number;
  readonly recordedAt: string;
};
