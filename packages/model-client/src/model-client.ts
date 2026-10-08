import type {
  ModelCatalog,
  ModelProviderList,
  ModelResponseRecord,
  ProviderSettings,
  ReasoningSelection,
} from "@zhiyin/contract";
import { serverSentEvents, withoutStalling } from "./stream.js";
import {
  classifyFailure,
  ModelClientError,
  refusalBody,
  type ProviderError,
} from "./failures.js";
import { providerMessages, usageFrom } from "./wire.js";
import {
  withRetries,
  type RestartingEvent,
  type RetryingEvent,
  type RetryOptions,
} from "./retry.js";
import {
  ProviderAccount,
  type ProviderAccountOptions,
} from "./provider-account.js";

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
   * event says when; without this, such a failure is reported. ADR 0011.
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
  /** A failed attempt is about to be made again, after `delayMs`. ADR 0011. */
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
    };

/**
 * Every failure is thrown as an error named `ModelClientError` carrying a
 * `code`. The name and code are the contract, not the class: a caller holding
 * only this interface recognises a failure without importing an implementation.
 */
export interface ModelClient {
  send(request: ModelRequest): AsyncIterable<ModelEvent>;
  settings(): Promise<ProviderSettings>;
  setApiKey(apiKey: string): Promise<void>;
  clearApiKey(): Promise<void>;
  /** The models this account may use. */
  models(): Promise<ModelCatalog>;
  /** The upstreams that serve one model. */
  modelProviders(model: string): Promise<ModelProviderList>;
  /** Choose the model and the upstreams routing may use, as one change. */
  selectModel(model: string, providers: readonly string[]): Promise<void>;
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

export type OpenRouterModelClientOptions = ProviderAccountOptions & {
  readonly endpoint?: string;
  readonly fetcher?: ModelFetch;
  /**
   * How long the stream may go silent before it is abandoned. Generous by
   * default: a large model may think for a long time before its first token,
   * and cutting off real work is worse than waiting.
   */
  readonly stallTimeoutMs?: number;
  /** How retries wait. Replaced in tests; the policy itself is fixed. */
  readonly retry?: RetryOptions;
};

type ProviderChunk = {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly provider?: unknown;
  /**
   * A failure the provider could not put in the status line, because the status
   * line went out with the headers before anything went wrong. Carries the same
   * numeric codes an HTTP failure would.
   */
  readonly error?: ProviderError;
  readonly choices?: readonly {
    readonly delta?: {
      readonly reasoning?: unknown;
      readonly reasoning_content?: unknown;
      readonly reasoning_details?: readonly {
        readonly type?: unknown;
        readonly text?: unknown;
        readonly summary?: unknown;
      }[];
      readonly content?: unknown;
      readonly tool_calls?: readonly {
        readonly index?: unknown;
        readonly id?: unknown;
        readonly function?: {
          readonly name?: unknown;
          readonly arguments?: unknown;
        };
      }[];
    };
    readonly finish_reason?: unknown;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
    readonly cost?: unknown;
  };
};

const defaultEndpoint = "https://openrouter.ai/api/v1/chat/completions";
/**
 * A provider that stops sending without closing the connection is
 * indistinguishable, from here, from one that is still working — except that
 * it never stops being indistinguishable. Left alone it holds a task in
 * `running` forever, which reads to a person as the app having gone away.
 *
 * Five minutes of complete silence is not a slow model; a model streaming its
 * answer resets this on every chunk it sends.
 */
const defaultStallTimeoutMs = 300_000;

function defaultFetch(url: string, init: Parameters<ModelFetch>[1]) {
  return fetch(url, init) as Promise<ModelFetchResponse>;
}

export class OpenRouterModelClient implements ModelClient {
  readonly #account: ProviderAccount;
  readonly #endpoint: string;
  readonly #fetcher: ModelFetch;
  readonly #stallTimeoutMs: number;
  readonly #retry: RetryOptions | undefined;

  constructor(options: OpenRouterModelClientOptions) {
    this.#endpoint = options.endpoint ?? defaultEndpoint;
    this.#account = new ProviderAccount(options, this.#endpoint);
    this.#fetcher = options.fetcher ?? defaultFetch;
    this.#stallTimeoutMs = options.stallTimeoutMs ?? defaultStallTimeoutMs;
    this.#retry = options.retry;
  }

  send(request: ModelRequest): AsyncIterable<ModelEvent> {
    return withRetries(() => this.#attempt(request), request, this.#retry);
  }

  async *#attempt(request: ModelRequest): AsyncIterable<ModelEvent> {
    const chosen = await this.#account.current();
    if (!chosen)
      throw new ModelClientError(
        "noModel",
        "Choose a model on the Model page before starting a task.",
      );
    if (request.reasoning) {
      const capabilities = await this.#account.reasoning();
      if (!capabilities || capabilities.status !== "available")
        throw new ModelClientError(
          "unsupportedReasoning",
          "Reasoning settings could not be verified for this model. Try again in a moment.",
        );
      if (!request.reasoning.enabled && capabilities.required)
        throw new ModelClientError(
          "unsupportedReasoning",
          "This model requires reasoning and cannot turn it off.",
        );
      if (
        request.reasoning.enabled &&
        request.reasoning.effort &&
        !capabilities.efforts.includes(request.reasoning.effort)
      )
        throw new ModelClientError(
          "unsupportedReasoning",
          "This model does not support the selected reasoning effort.",
        );
    }
    const apiKey = await this.#account.apiKey();
    if (!apiKey) {
      throw new ModelClientError(
        "missingCredential",
        "Add an OpenRouter API key on the Model page before starting a task.",
      );
    }

    const body = {
      model: chosen.model,
      stream: true,
      messages: providerMessages(
        request.messages,
        chosen.model,
        request.cacheAfter,
      ),
      ...(request.session ? { session_id: request.session } : {}),
      ...(chosen.providers.length
        ? {
            provider: {
              only: [...chosen.providers],
              order: [...chosen.providers],
            },
          }
        : {}),
      ...(request.maximumOutputTokens !== undefined
        ? { max_tokens: request.maximumOutputTokens }
        : {}),
      ...(request.reasoning ? { reasoning: request.reasoning } : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }
        : {}),
    };

    let response: ModelFetchResponse;
    try {
      response = await this.#fetcher(this.#endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "Zhiyin",
        },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      // Cancelled by the caller, which is not a connection that failed.
      if (request.signal?.aborted) throw request.signal.reason;
      throw new ModelClientError(
        "networkFailure",
        "Could not reach OpenRouter. Check the connection and try again.",
        { cause: error },
      );
    }

    if (!response.ok)
      throw classifyFailure({
        status: response.status,
        headers: response.headers,
        model: chosen.model,
        ...(await refusalBody(response.body).then((error) =>
          error ? { error } : {},
        )),
      });
    if (!response.body) {
      throw new ModelClientError(
        "malformedResponse",
        "OpenRouter returned an empty response stream.",
      );
    }

    // Three independent signals that the provider is done: its `[DONE]`
    // sentinel, a `finish_reason` on a choice, and the usage chunk it sends
    // last. Requiring the sentinel alone would discard an answer that plainly
    // finished whenever a connection closes a beat early, which is not rare,
    // and lose a whole turn's work.
    let sawDone = false;
    let finishReason: string | undefined;
    let sawUsage = false;
    let requestId: string | undefined;
    let responseModel: string | undefined;
    let provider: string | undefined;
    let sawUsableOutput = false;
    for await (const data of serverSentEvents(
      withoutStalling(response.body, this.#stallTimeoutMs),
    )) {
      if (data === "[DONE]") {
        sawDone = true;
        break;
      }

      let chunk: ProviderChunk;
      try {
        chunk = JSON.parse(data) as ProviderChunk;
      } catch (error) {
        throw new ModelClientError(
          "malformedResponse",
          "OpenRouter returned an unreadable response.",
          { cause: error },
        );
      }

      // A failure the provider could not put in the status line. It has to end
      // the request: the alternative is a turn that stops early, keeps whatever
      // arrived before it, and is recorded as a completed answer - with the
      // provider's own explanation of what went wrong read and discarded.
      if (chunk.error) {
        throw classifyFailure({
          status: typeof chunk.error.code === "number" ? chunk.error.code : 0,
          error: chunk.error,
          model: chosen.model,
          inStream: true,
        });
      }

      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (typeof chunk.id === "string") requestId = chunk.id;
      if (typeof chunk.model === "string") responseModel = chunk.model;
      if (typeof chunk.provider === "string") provider = chunk.provider;
      const reasoning =
        typeof delta?.reasoning === "string" && delta.reasoning
          ? delta.reasoning
          : typeof delta?.reasoning_content === "string" &&
              delta.reasoning_content
            ? delta.reasoning_content
            : Array.isArray(delta?.reasoning_details)
              ? delta.reasoning_details
                  .map((detail) =>
                    !detail || typeof detail !== "object"
                      ? ""
                      : detail.type === "reasoning.text" &&
                          typeof detail.text === "string"
                        ? detail.text
                        : detail.type === "reasoning.summary" &&
                            typeof detail.summary === "string"
                          ? detail.summary
                          : "",
                  )
                  .join("")
              : "";
      if (reasoning) yield { kind: "reasoningDelta", text: reasoning };
      if (typeof choice?.delta?.content === "string") {
        if (choice.delta.content) sawUsableOutput = true;
        yield { kind: "textDelta", text: choice.delta.content };
      }
      for (const toolCall of choice?.delta?.tool_calls ?? []) {
        if (typeof toolCall.index !== "number") continue;
        sawUsableOutput = true;
        yield {
          kind: "toolCallDelta",
          index: toolCall.index,
          ...(typeof toolCall.id === "string" ? { callId: toolCall.id } : {}),
          ...(typeof toolCall.function?.name === "string"
            ? { name: toolCall.function.name }
            : {}),
          ...(typeof toolCall.function?.arguments === "string"
            ? { argumentsDelta: toolCall.function.arguments }
            : {}),
        };
      }
      if (typeof choice?.finish_reason === "string")
        finishReason = choice.finish_reason;
      const usage = usageFrom(chunk);
      if (usage) {
        sawUsage = true;
        yield {
          kind: "usage",
          usage: provider ? { ...usage, provider } : usage,
        };
      }
    }

    if (!sawDone && finishReason === undefined && !sawUsage) {
      throw new ModelClientError(
        "malformedResponse",
        "OpenRouter ended the response before completion.",
      );
    }
    const termination =
      finishReason !== undefined
        ? ("finishReason" as const)
        : sawDone
          ? ("sentinel" as const)
          : ("usage" as const);
    const complete =
      termination !== "usage" && finishReason !== "length" && sawUsableOutput;
    yield {
      kind: "done",
      ...(finishReason === undefined ? {} : { finishReason }),
      response: {
        ...(requestId ? { requestId } : {}),
        ...(responseModel ? { model: responseModel } : {}),
        ...(provider ? { provider } : {}),
        finishReason: finishReason ?? null,
        termination,
        complete,
      },
    };
  }

  settings(): Promise<ProviderSettings> {
    return this.#account.settings();
  }

  setApiKey(apiKey: string): Promise<void> {
    return this.#account.setApiKey(apiKey);
  }

  clearApiKey(): Promise<void> {
    return this.#account.clearApiKey();
  }

  models(): Promise<ModelCatalog> {
    return this.#account.models();
  }

  modelProviders(model: string): Promise<ModelProviderList> {
    return this.#account.modelProviders(model);
  }

  selectModel(model: string, providers: readonly string[]): Promise<void> {
    return this.#account.selectModel(model, providers);
  }
}
