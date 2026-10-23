import type {
  ApiKeySaveOutcome,
  EstimatedCost,
  ModelCatalog,
  ModelListState,
  ModelProviderList,
  ModelReplay,
  ModelResponseRecord,
  ProviderSettings,
  ProviderSummary,
  ProviderTarget,
  ReasoningSelection,
} from "@zhiyin/contract";
import type { RestartingEvent, RetryingEvent } from "./retry.js";

export type ModelToolCall = {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
};

/**
 * A part of a message that is not text. Only a user message may carry one:
 * the provider's format has no place for a picture in a tool's answer, so a
 * picture that answers a tool call follows it as a message of its own.
 */
export type ModelContentPart =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "image";
      readonly mediaType: string;
      /** Base64, without a data URL prefix. */
      readonly data: string;
    };

export type ModelMessage =
  | { readonly role: "system"; readonly content: string }
  | {
      readonly role: "user";
      readonly content: string | readonly ModelContentPart[];
    }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls?: readonly ModelToolCall[];
      /**
       * How the model reasoned to this turn, kept beside its words. Sent back
       * only to a provider that asks for it.
       */
      readonly reasoning?: string;
      /**
       * What the provider that wrote this turn needs back to continue from
       * it. Sent back only to that provider, in the format it came in.
       */
      readonly replay?: ModelReplay;
    }
  | {
      readonly role: "tool";
      readonly content: string;
      readonly toolCallId: string;
      readonly name: string;
    };

export type ModelTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
};

export type ModelRequest = {
  readonly reasoning?: ReasoningSelection;
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelTool[];
  readonly maximumOutputTokens?: number;
  readonly signal?: AbortSignal;
  /**
   * The caller can take back what it received from a failed attempt, so the
   * request may be started again after output was passed on. A `restarting`
   * event says when; without this, such a failure is reported. ADR 0016.
   */
  readonly restartable?: boolean;
  /**
   * The conversation the request belongs to, sent as OpenRouter's
   * `session_id` so its requests stay with the provider holding its cache.
   */
  readonly session?: string;
  /**
   * Messages the next request is expected to repeat up to, in order. Marked
   * as places the cache may end, for the providers that need the mark.
   */
  readonly cacheAfter?: readonly number[];
};

export type ModelUsage = {
  readonly requestId: string;
  readonly model: string;
  /** The upstream OpenRouter routed the request to, when it said. */
  readonly provider?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd?: number;
  /**
   * Where the provider reported no cost: what the request cost by the shipped
   * price list, when the list prices everything it used.
   */
  readonly estimatedCost?: EstimatedCost;
  /** Of the input, what the provider read from its cache, when it said. */
  readonly cacheReadTokens?: number;
  /** Of the input, what the provider wrote to its cache, when it said. */
  readonly cacheWriteTokens?: number;
  /** Of the output, what the model spent reasoning, when it said. */
  readonly reasoningTokens?: number;
};

export type ModelEvent =
  | { readonly kind: "reasoningDelta"; readonly text: string }
  | { readonly kind: "textDelta"; readonly text: string }
  | {
      readonly kind: "toolCallDelta";
      readonly index: number;
      readonly callId?: string;
      readonly name?: string;
      readonly argumentsDelta?: string;
    }
  | { readonly kind: "usage"; readonly usage: ModelUsage }
  /** A failed attempt is about to be made again, after `delayMs`. ADR 0016. */
  | RetryingEvent
  | RestartingEvent
  | {
      readonly kind: "done";
      /**
       * Why the provider stopped, when it said. `length` means the answer was
       * cut off at the output limit and is incomplete however finished it
       * looks; absent means the provider ended without saying.
       */
      readonly finishReason?: string;
      /** Durable, provider-neutral evidence for diagnosing this response. */
      readonly response?: ModelResponseRecord;
      /**
       * What the provider needs back with this turn, to keep with it. Read
       * by nothing but the model client.
       */
      readonly replay?: ModelReplay;
    };

/** A request as its caller counted it, where the provider never did. */
export type UncountedUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Of the input, what is taken to have been read from the cache. */
  readonly cacheReadTokens?: number;
  readonly reasoningTokens?: number;
};

/** A key that was kept: checked with the provider, or kept unchecked. */
export type KeptApiKey = Exclude<ApiKeySaveOutcome, { status: "refused" }>;

/**
 * Every failure is thrown as an error named `ModelClientError` carrying a
 * `code`. The name and code are the contract, not the class: a caller holding
 * only this interface recognises a failure without importing an implementation.
 */
export interface ModelClient {
  send(request: ModelRequest): AsyncIterable<ModelEvent>;
  /**
   * What a request that ended before the provider counted it is taken to
   * have used: the caller's own count, for the model it went to, at the
   * price list's prices. Nothing when no model is chosen.
   */
  uncounted?(usage: UncountedUsage): Promise<ModelUsage | undefined>;
  settings(): Promise<ProviderSettings>;
  /**
   * Keeps a key the provider did not refuse, and says whether it was checked.
   * A refused key, or one that could not be stored, throws and is not kept.
   */
  setApiKey(apiKey: string): Promise<KeptApiKey>;
  clearApiKey(): Promise<void>;
  /** The models this account may use. */
  models(): Promise<ModelCatalog>;
  /** The upstreams that serve one model. */
  modelProviders(model: string): Promise<ModelProviderList>;
  /** Choose the model and the upstreams routing may use, as one change. */
  selectModel(model: string, providers: readonly string[]): Promise<void>;
}

/**
 * Every provider models can be reached through, each set up on its own: a key
 * or a model is set up for the provider and region it was offered to,
 * whichever one is chosen.
 */
export interface ProviderDirectory {
  /** Each provider with its regions, whether it can be used, and its keys. */
  list(): Promise<readonly ProviderSummary[]>;
  /**
   * One provider and region. Choosing a model on it chooses it. Throws a
   * `ModelClientError` for a provider or region it does not know.
   */
  for(target: ProviderTarget): ModelClient;
}

/**
 * Zhiyin's model list as the person sees and steers it: which list is in
 * force, a look for a newer one, and whether newer ones are read at all
 * (ADR 0031).
 */
export interface ModelListControl {
  state(): ModelListState;
  /** Looks for a newer list now, and answers once the look has ended. */
  check(): Promise<ModelListState>;
  setUpdates(enabled: boolean): Promise<ModelListState>;
  /** Told whenever another list comes into force. */
  onChanged(listener: () => void): void;
}

export type ModelFetchResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: AsyncIterable<Uint8Array> | null;
};

export type ModelFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<ModelFetchResponse>;
