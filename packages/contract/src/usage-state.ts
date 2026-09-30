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
};

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

export type EvidenceState = {
  readonly corrections: {
    readonly retainedEntries: number;
    readonly shownEntries: number;
    readonly maximumEntries: number;
    readonly entries: readonly {
      readonly at: string;
      readonly taskId: string;
      readonly taskTitle?: string;
      readonly toolName: string;
      readonly kind: "quiet-retry" | "repair-applied" | "repair-rejected";
      readonly reason: string;
      readonly cause?: string;
      readonly before?: string;
      readonly after?: string;
    }[];
  };
  readonly recovery: {
    readonly usedBytes: number;
    readonly retainedFiles: number;
    readonly excludedFiles: number;
    readonly limits: {
      readonly totalBytes: number;
      readonly fileBytes: number;
      readonly versionsPerPath: number;
      readonly maximumAgeDays: number;
    };
  };
  readonly policy: {
    readonly correctionRedaction: string;
    readonly taskDeletion: string;
    readonly privateStorage: string;
  };
};

export type ProviderUsage = {
  readonly requestId: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd?: number;
  /** Of the input, what the provider read from and wrote to its cache. */
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly recordedAt: string;
};
