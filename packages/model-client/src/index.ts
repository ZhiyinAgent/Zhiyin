/**
 * Talks to the language model. The provider's wire format does not escape this
 * package — nothing else names a provider-specific field.
 *
 * Boundaries and invariants: docs/architecture/features/model-client/README.md
 */

import type {
  ModelCatalog,
  ModelProviderList,
  ModelResponseRecord,
  ProviderSettings,
  ReasoningSelection,
  ReasoningCapabilities,
} from "@zhiyin/contract";
import {
  fetchOpenRouterCatalog,
  fetchOpenRouterModelProviders,
  type CatalogFetch,
  type CatalogOptions,
} from "./catalog.js";
import type { ModelChoice, ModelChoiceValue } from "./choice.js";
import { acceptsImages, reasoningCapabilities } from "./reasoning.js";
export { fetchOpenRouterModelInfo } from "./reasoning.js";
export {
  fetchOpenRouterCatalog,
  fetchOpenRouterModelProviders,
  type CatalogFetch,
  type CatalogOptions,
} from "./catalog.js";
export {
  FileModelChoice,
  ModelChoiceError,
  type ModelChoice,
  type ModelChoiceValue,
} from "./choice.js";

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
  readonly reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  readonly jsonMode?: boolean;
  readonly responseFormat?: {
    readonly name: string;
    readonly schema: Readonly<Record<string, unknown>>;
  };
  readonly signal?: AbortSignal;
};

export type ModelUsage = {
  readonly requestId: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd?: number;
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

export type ModelClientErrorCode =
  | "unsupportedReasoning"
  | "missingCredential"
  | "unauthorized"
  | "rateLimited"
  | "modelUnavailable"
  | "contextExceeded"
  | "credentialUnavailable"
  | "networkFailure"
  | "malformedResponse";

export class ModelClientError extends Error {
  readonly code: ModelClientErrorCode;
  readonly retryAfterMs?: number;

  constructor(
    code: ModelClientErrorCode,
    message: string,
    options: { retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ModelClientError";
    this.code = code;
    if (options.retryAfterMs !== undefined)
      this.retryAfterMs = options.retryAfterMs;
  }
}

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

export type CredentialEntry = {
  getPassword(): Promise<string | undefined>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
};

export type ProviderCredentialsOptions = {
  readonly environment: () => string | undefined;
  readonly entry?: CredentialEntry;
};

export class ProviderCredentials {
  readonly #environment: ProviderCredentialsOptions["environment"];
  readonly #providedEntry: CredentialEntry | undefined;
  #loadedEntry: Promise<CredentialEntry> | undefined;

  constructor(options: ProviderCredentialsOptions) {
    this.#environment = options.environment;
    this.#providedEntry = options.entry;
  }

  async get(): Promise<string | undefined> {
    const environment = this.#environment()?.trim();
    if (environment) return environment;
    try {
      return await (await this.#entry()).getPassword();
    } catch (error) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
        { cause: error },
      );
    }
  }

  async status(): Promise<ProviderSettings["credential"]> {
    if (this.#environment()?.trim()) {
      return { status: "configured", source: "environment" };
    }
    try {
      const password = await (await this.#entry()).getPassword();
      return password
        ? { status: "configured", source: "credentialStore" }
        : { status: "missing", source: "none" };
    } catch {
      return {
        status: "unavailable",
        source: "credentialStore",
        reason: "Secure key storage is unavailable.",
      };
    }
  }

  async set(apiKey: string): Promise<void> {
    const value = apiKey.trim();
    if (!value) {
      throw new ModelClientError(
        "missingCredential",
        "Enter an OpenRouter API key before saving.",
      );
    }
    try {
      await (await this.#entry()).setPassword(value);
    } catch (error) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
        { cause: error },
      );
    }
  }

  async clear(): Promise<void> {
    try {
      await (await this.#entry()).deletePassword();
    } catch (error) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
        { cause: error },
      );
    }
  }

  async #entry(): Promise<CredentialEntry> {
    if (this.#providedEntry) return this.#providedEntry;
    this.#loadedEntry ??= import("@napi-rs/keyring").then(
      ({ AsyncEntry }) => new AsyncEntry("Zhiyin", "openrouter"),
    );
    return this.#loadedEntry;
  }
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

export type OpenRouterModelClientOptions = {
  readonly modelInfo?: (model: string) => Promise<unknown>;
  readonly apiKey?: () => Promise<string | undefined>;
  readonly credentials?: ProviderCredentials;
  readonly model?: string;
  /**
   * Where the person's model and routing choice lives. When absent the client
   * uses `model` and `providers`, which is what the tests and the auxiliary
   * paths want.
   */
  readonly choice?: ModelChoice;
  readonly catalog?: {
    models(options: CatalogOptions): Promise<ModelCatalog>;
    providers(
      model: string,
      options: CatalogOptions,
    ): Promise<ModelProviderList>;
  };
  readonly endpoint?: string;
  /**
   * Which OpenRouter upstreams may serve requests. An empty list lets
   * OpenRouter choose from all of them.
   */
  readonly providers?: readonly string[];
  readonly fetcher?: ModelFetch;
  /** How a key is checked before it is kept. Replaced wholesale in tests. */
  readonly catalogFetch?: CatalogFetch;
  /**
   * How long the stream may go silent before it is abandoned. Generous by
   * default: a large model may think for a long time before its first token,
   * and cutting off real work is worse than waiting.
   */
  readonly stallTimeoutMs?: number;
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
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly metadata?: { readonly error_type?: unknown };
  };
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
 * The account behind a key. Chosen for this because it is the endpoint that
 * actually refuses a bad key: the catalogue answers one normally, verified
 * against the live provider on 2026-09-10.
 */
const keyUrl = "https://openrouter.ai/api/v1/key";

const defaultCatalogFetch: CatalogFetch = (url, init) =>
  fetch(url, {
    headers: init.headers,
    signal: AbortSignal.timeout(15_000),
  });

/**
 * Which model answers before anyone has chosen one. The feature that talks to
 * the providers owns this; a composition that wants a different starting point
 * passes one rather than repeating a name.
 */
export const defaultModel = "z-ai/glm-5.3-flash";

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

function retryAfterMs(headers: ModelFetchResponse["headers"]) {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** How much of a refusal is worth reading. Providers answer these in a sentence. */
const refusalBodyLimit = 4_096;

/**
 * The provider's own explanation of a refusal, where it gave one.
 *
 * A failure in the status line carries its reason in the body, and until now
 * that body was thrown away unread - which is why one refusal could not be told
 * from another that happens to share a status code.
 */
async function refusalMessage(
  body: AsyncIterable<Uint8Array> | null,
): Promise<string | undefined> {
  if (!body) return undefined;
  const decoder = new TextDecoder();
  let text = "";
  try {
    for await (const chunk of body) {
      text += decoder.decode(chunk, { stream: true });
      if (text.length >= refusalBodyLimit) break;
    }
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === "string" && message.trim() ? message : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a refusal is about the model id rather than the request.
 *
 * Verified against the live provider on 2026-09-13: an id OpenRouter does not
 * recognise is refused with 400 "<id> is not a valid model ID", while a model
 * that existed and has since been retired answers 404 "No endpoints found for
 * <id>". The second was already read as a model failure; the first was being
 * read as the request being too large, which sends somebody to shorten a
 * message that was never the problem.
 */
function refusesTheModel(message: string | undefined): boolean {
  return (
    message !== undefined &&
    /not a valid model|no endpoints found/i.test(message)
  );
}

function responseError(
  response: ModelFetchResponse,
  model?: string,
  providerMessage?: string,
): ModelClientError {
  return failureFor(
    response.status,
    undefined,
    response.headers,
    model,
    providerMessage,
  );
}

/**
 * One failure, whether it arrived in the status line or inside the stream.
 *
 * A rate limit is a rate limit even when the provider had already sent its
 * headers, so the same code produces the same typed outcome and the caller does
 * not have to know where it was reported. `detail` is the provider's own
 * sentence where there is one; it replaces our wording rather than joining it,
 * because two explanations of one failure read as two failures.
 */
function failureFor(
  status: number,
  detail?: string,
  headers?: ModelFetchResponse["headers"],
  model?: string,
  providerMessage?: string,
): ModelClientError {
  const response = {
    status,
    headers: headers ?? { get: () => null },
  } as ModelFetchResponse;
  const error = statusError(response, model, providerMessage);
  return detail
    ? new ModelClientError(
        error.code,
        detail,
        error.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: error.retryAfterMs },
      )
    : error;
}

function statusError(
  response: ModelFetchResponse,
  model?: string,
  providerMessage?: string,
): ModelClientError {
  if (response.status === 401 || response.status === 403) {
    return new ModelClientError(
      "unauthorized",
      "OpenRouter rejected the API key.",
    );
  }
  if (response.status === 429) {
    const retry = retryAfterMs(response.headers);
    return new ModelClientError(
      "rateLimited",
      "Every allowed provider is out of capacity for this model. Try again shortly.",
      retry === undefined ? {} : { retryAfterMs: retry },
    );
  }
  if (response.status === 404) {
    /*
     * Routing matched nobody: an allowlist naming no provider that serves this
     * model, or a request parameter none of the allowed providers support.
     * Reporting it as the model being down sends a person to wait for a
     * recovery that is not coming.
     *
     * A model the provider has withdrawn arrives here too, and is the case a
     * person can actually do something about - so the stored id is named, and
     * so is the page where it is changed. Without that, an app that stops
     * answering gives no indication that a choice made months ago is the cause.
     */
    return new ModelClientError(
      "modelUnavailable",
      model
        ? `No allowed provider can serve “${model}”. If that model has been withdrawn, choose another in Settings.`
        : "No allowed provider can serve the selected model.",
    );
  }
  if (response.status === 503) {
    return new ModelClientError(
      "modelUnavailable",
      "The selected model is not available right now.",
    );
  }
  if (response.status === 400 && refusesTheModel(providerMessage)) {
    return new ModelClientError(
      "modelUnavailable",
      model
        ? `OpenRouter does not recognise “${model}”. It may have been withdrawn; choose another model in Settings.`
        : "OpenRouter does not recognise the selected model. Choose another in Settings.",
    );
  }
  if (response.status === 400 || response.status === 413) {
    return new ModelClientError(
      "contextExceeded",
      "The request is too large for the selected model.",
    );
  }
  return new ModelClientError(
    "networkFailure",
    `OpenRouter could not complete the request (HTTP ${response.status}).`,
  );
}

/**
 * The same bytes, but a gap longer than `stallTimeoutMs` between them ends the
 * stream instead of waiting on it.
 *
 * The underlying iterator is asked to close so the abandoned request releases
 * its socket, but that request is not waited on: an iterator suspended inside
 * the very read that stalled will not answer `return()` either, and waiting
 * for it would reintroduce the hang this exists to end.
 */
async function* withoutStalling(
  body: AsyncIterable<Uint8Array>,
  stallTimeoutMs: number,
): AsyncIterable<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<"stalled">((resolve) => {
        timer = setTimeout(() => resolve("stalled"), stallTimeoutMs);
      });
      let step: IteratorResult<Uint8Array> | "stalled";
      try {
        step = await Promise.race([iterator.next(), stalled]);
      } finally {
        clearTimeout(timer);
      }
      if (step === "stalled") {
        throw new ModelClientError(
          "networkFailure",
          "OpenRouter stopped responding partway through. Try again.",
        );
      }
      if (step.done) return;
      yield step.value;
    }
  } finally {
    void iterator.return?.().catch(() => undefined);
  }
}

async function* serverSentEvents(body: AsyncIterable<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";

  function takeEvent(): string | undefined {
    const boundary = /\r?\n\r?\n/.exec(buffer);
    if (!boundary || boundary.index === undefined) return undefined;
    const block = buffer.slice(0, boundary.index);
    buffer = buffer.slice(boundary.index + boundary[0].length);
    return block;
  }

  function dataFrom(block: string) {
    return block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
  }

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let block = takeEvent();
    while (block !== undefined) {
      const data = dataFrom(block);
      if (data) yield data;
      block = takeEvent();
    }
  }

  buffer += decoder.decode();
  const data = dataFrom(buffer);
  if (data) yield data;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageFrom(chunk: ProviderChunk): ModelUsage | undefined {
  if (!chunk.usage) return undefined;
  return {
    requestId: typeof chunk.id === "string" ? chunk.id : "unknown",
    model: typeof chunk.model === "string" ? chunk.model : "unknown",
    inputTokens: finiteNumber(chunk.usage.prompt_tokens),
    outputTokens: finiteNumber(chunk.usage.completion_tokens),
    totalTokens: finiteNumber(chunk.usage.total_tokens),
    ...(typeof chunk.usage.cost === "number" &&
    Number.isFinite(chunk.usage.cost)
      ? { costUsd: chunk.usage.cost }
      : {}),
  };
}

function providerMessage(message: ModelMessage) {
  if (message.role === "assistant") {
    return {
      role: message.role,
      content: message.content,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  }
  if (message.role === "tool") {
    return {
      role: message.role,
      content: message.content,
      tool_call_id: message.toolCallId,
      name: message.name,
    };
  }
  if (message.role === "user" && typeof message.content !== "string") {
    return {
      role: message.role,
      content: message.content.map((part) =>
        part.kind === "text"
          ? { type: "text", text: part.text }
          : {
              type: "image_url",
              image_url: {
                url: `data:${part.mediaType};base64,${part.data}`,
              },
            },
      ),
    };
  }
  return message;
}

export class OpenRouterModelClient implements ModelClient {
  readonly #modelInfo: OpenRouterModelClientOptions["modelInfo"];
  /** The catalogue's entry for the chosen model, looked up once for every answer. */
  #description: Promise<unknown> | undefined;
  readonly #apiKey: OpenRouterModelClientOptions["apiKey"];
  readonly #credentials: ProviderCredentials | undefined;
  readonly #model: string;
  readonly #providers: readonly string[];
  readonly #choice: ModelChoice | undefined;
  readonly #catalog: NonNullable<OpenRouterModelClientOptions["catalog"]>;
  /** Cleared when the model changes: both answers are about one model. */
  #describedModel: string | undefined;
  readonly #endpoint: string;
  readonly #fetcher: ModelFetch;
  readonly #stallTimeoutMs: number;
  readonly #catalogFetch: CatalogFetch | undefined;

  constructor(options: OpenRouterModelClientOptions) {
    this.#modelInfo = options.modelInfo;
    this.#apiKey = options.apiKey;
    this.#credentials = options.credentials;
    this.#model = options.model ?? defaultModel;
    /*
     * Unrestricted until somebody restricts it (ADR 0030, superseding ADR
     * 0022's allowlist). The list this used to default to named one model's
     * first-party provider, which serves no other model - so any model chosen
     * without an upstream list alongside it was routed to upstreams that do not
     * carry it and refused. Verified live on 2026-09-13:
     * `inception/mercury-2.5` was refused 404 through this client and served
     * 200 without the restriction.
     */
    this.#providers = options.providers ?? [];
    this.#choice = options.choice;
    this.#catalog = options.catalog ?? {
      models: fetchOpenRouterCatalog,
      providers: fetchOpenRouterModelProviders,
    };
    this.#endpoint = options.endpoint ?? defaultEndpoint;
    this.#fetcher = options.fetcher ?? defaultFetch;
    this.#stallTimeoutMs = options.stallTimeoutMs ?? defaultStallTimeoutMs;
    this.#catalogFetch = options.catalogFetch;
  }

  async *send(request: ModelRequest): AsyncIterable<ModelEvent> {
    await this.#current();
    if (request.reasoning) {
      const capabilities = await this.#loadReasoning();
      if (!capabilities || capabilities.status !== "available")
        throw new ModelClientError(
          "unsupportedReasoning",
          "Reasoning settings could not be verified for this model. Try again after refreshing Settings.",
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
    const apiKey = this.#credentials
      ? await this.#credentials.get()
      : await this.#apiKey?.();
    if (!apiKey) {
      throw new ModelClientError(
        "missingCredential",
        "Add an OpenRouter API key in Settings before starting a task.",
      );
    }

    /*
     * One `provider` object, built once. It used to be spread in from two
     * mutually exclusive branches, and adding a third source of it would have
     * meant the last spread winning — a pin silently dropped on exactly the
     * structured-output requests that also constrain routing.
     */
    const chosen = await this.#current();
    const routing = {
      ...(chosen.providers.length
        ? { only: [...chosen.providers], order: [...chosen.providers] }
        : {}),
      ...(request.responseFormat || request.jsonMode
        ? { require_parameters: true }
        : {}),
    };

    const body = {
      model: chosen.model,
      stream: true,
      messages: request.messages.map(providerMessage),
      ...(Object.keys(routing).length ? { provider: routing } : {}),
      ...(request.maximumOutputTokens !== undefined
        ? { max_tokens: request.maximumOutputTokens }
        : {}),
      ...(request.reasoning
        ? { reasoning: request.reasoning }
        : request.reasoningEffort
          ? { reasoning: { effort: request.reasoningEffort } }
          : {}),
      ...(request.responseFormat
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: request.responseFormat.name,
                strict: true,
                schema: request.responseFormat.schema,
              },
            },
          }
        : request.jsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
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
      throw new ModelClientError(
        "networkFailure",
        "Could not reach OpenRouter. Check the connection and try again.",
        { cause: error },
      );
    }

    if (!response.ok)
      throw responseError(
        response,
        chosen.model,
        await refusalMessage(response.body),
      );
    if (!response.body) {
      throw new ModelClientError(
        "malformedResponse",
        "OpenRouter returned an empty response stream.",
      );
    }

    // Three independent signals that the provider is done: its `[DONE]`
    // sentinel, a `finish_reason` on a choice, and the usage chunk it sends
    // last. Requiring the sentinel alone discards an answer that plainly
    // finished when a connection closes a beat early — which is not a rare
    // event, and cost a whole turn's work when it happened.
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
        const message =
          typeof chunk.error.message === "string" && chunk.error.message.trim()
            ? chunk.error.message
            : undefined;
        throw failureFor(
          typeof chunk.error.code === "number" ? chunk.error.code : 0,
          message,
          undefined,
          chosen.model,
        );
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
        yield { kind: "usage", usage };
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

  /**
   * The model and routing in force right now. Read on every request rather than
   * captured at construction, so a choice saved mid-session takes effect on the
   * next turn instead of at the next restart.
   */
  async #current(): Promise<ModelChoiceValue> {
    const value = this.#choice
      ? await this.#choice.current()
      : { model: this.#model, providers: this.#providers };
    if (this.#describedModel !== value.model) {
      this.#describedModel = value.model;
      this.#description = undefined;
    }
    return value;
  }

  #catalogOptions(): CatalogOptions {
    return {
      apiKey: async () =>
        this.#credentials ? this.#credentials.get() : this.#apiKey?.(),
    };
  }

  async models(): Promise<ModelCatalog> {
    return this.#catalog.models(this.#catalogOptions());
  }

  async modelProviders(model: string): Promise<ModelProviderList> {
    return this.#catalog.providers(model, this.#catalogOptions());
  }

  async selectModel(
    model: string,
    providers: readonly string[],
  ): Promise<void> {
    if (!this.#choice) {
      throw new ModelClientError(
        "modelUnavailable",
        "The model is fixed by the environment and cannot be changed here.",
      );
    }
    await this.#choice.set({ model, providers: [...providers] });
    // The next request re-reads the choice; drop what was cached about the old
    // model rather than answering questions about it under a new name.
    this.#describedModel = undefined;
    this.#description = undefined;
  }

  /**
   * Whether this model can be shown a picture. Read from the catalogue rather
   * than from the model's name: within one family the answer differs from
   * version to version, and a name list would be wrong the week it was written.
   */
  async #acceptsImages(): Promise<boolean> {
    const description = await this.#describe();
    return description.ok && acceptsImages(description.value);
  }

  async #loadReasoning(): Promise<ReasoningCapabilities | undefined> {
    if (!this.#modelInfo) return undefined;
    const description = await this.#describe();
    return description.ok
      ? reasoningCapabilities(description.value)
      : {
          status: "unavailable" as const,
          /*
           * Not "restart the app", which is what this used to say and was never
           * true: `#describe` forgets a lookup that failed, so the next question
           * asked about this model tries again. Telling somebody to restart
           * sends them to do something that changes nothing.
           */
          reason:
            "Reasoning settings could not be loaded. They are read again the next time they are needed.",
        };
  }

  /**
   * The catalogue's entry for the chosen model. One lookup answers every
   * question asked about the model; a lookup that failed is forgotten, so the
   * next question asks again.
   */
  async #describe(): Promise<
    { readonly ok: true; readonly value: unknown } | { readonly ok: false }
  > {
    if (!this.#modelInfo) return { ok: false };
    const { model } = await this.#current();
    const lookup = (this.#description ??= this.#modelInfo(model));
    try {
      return { ok: true, value: await lookup };
    } catch {
      if (this.#description === lookup) this.#description = undefined;
      return { ok: false };
    }
  }

  async settings(): Promise<ProviderSettings> {
    const chosen = await this.#current();
    const reasoning = await this.#loadReasoning();
    const credential = this.#credentials
      ? await this.#credentials.status()
      : (await this.#apiKey?.())
        ? ({ status: "configured", source: "environment" } as const)
        : ({ status: "missing", source: "none" } as const);
    return {
      ...(reasoning ? { reasoning } : {}),
      acceptsImages: await this.#acceptsImages(),
      model: chosen.model,
      providers: [...chosen.providers],
      endpoint: this.#endpoint,
      credential,
    };
  }

  /**
   * Checks a key with the provider before keeping it.
   *
   * The catalogue cannot answer this question - it serves a rejected key the
   * same as any other - so the account endpoint is asked instead. A key that is
   * refused is never stored: storing it would turn one mistake at setup into a
   * failure somewhere else later, saying something else, with nothing pointing
   * back at the key.
   *
   * A check that could not be made is not a refusal. Somebody offline has not
   * typed the wrong key and must not be told they have, so the key is kept and
   * the trouble is named for what it is.
   */
  async setApiKey(apiKey: string): Promise<void> {
    if (!this.#credentials) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
      );
    }
    const checked = await this.#checkApiKey(apiKey);
    if (!checked.accepted) throw checked.error;
    await this.#credentials.set(apiKey);
    if (checked.error) throw checked.error;
  }

  async #checkApiKey(apiKey: string): Promise<{
    readonly accepted: boolean;
    readonly error?: ModelClientError;
  }> {
    const fetcher = this.#catalogFetch ?? defaultCatalogFetch;
    try {
      const response = await fetcher(keyUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) return { accepted: true };
      return { accepted: false, error: failureFor(response.status) };
    } catch (error) {
      return {
        accepted: true,
        error: new ModelClientError(
          "networkFailure",
          "The key was saved but could not be checked with OpenRouter. If it turns out to be wrong, requests will say so.",
          { cause: error },
        ),
      };
    }
  }

  async clearApiKey(): Promise<void> {
    if (!this.#credentials) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
      );
    }
    await this.#credentials.clear();
  }
}
