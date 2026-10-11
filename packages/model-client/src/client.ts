/**
 * The client every provider is reached through. It decides whether a request
 * may be sent at all (a chosen model, settings the model accepts, a key) and
 * when a failed one is sent again (ADR 0011); the provider decides how it is
 * sent and what its answers and failures mean.
 */

import type {
  ModelCatalog,
  ModelProviderList,
  ProviderSettings,
} from "@zhiyin/contract";
import { estimateCost } from "./estimated-cost.js";
import { ModelClientError } from "./failures.js";
import type {
  ModelClient,
  ModelEvent,
  ModelFetch,
  ModelFetchResponse,
  ModelMessage,
  ModelRequest,
} from "./model-client.js";
import { platformOf, refuseUnavailable, type Provider } from "./provider.js";
import {
  ProviderAccount,
  type ProviderAccountOptions,
} from "./provider-account.js";
import { withRetries, type RetryOptions } from "./retry.js";

export type ProviderModelClientOptions = ProviderAccountOptions & {
  /** Where every request goes instead of the provider's own host. */
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
  /** The time a cost is estimated at, for prices that change by hour. */
  readonly now?: () => Date;
};

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

/**
 * The conversation with each turn's replay record kept only where this
 * provider wrote it: a record is signed or encrypted for the provider that
 * produced it, and means nothing to another one.
 */
function ownReplaysOnly(
  messages: readonly ModelMessage[],
  provider: string,
): readonly ModelMessage[] {
  return messages.map((message) => {
    if (
      message.role !== "assistant" ||
      !message.replay ||
      message.replay.provider === provider
    )
      return message;
    return Object.fromEntries(
      Object.entries(message).filter(([field]) => field !== "replay"),
    ) as ModelMessage;
  });
}

export class ProviderModelClient implements ModelClient {
  readonly #provider: Provider;
  readonly #account: ProviderAccount;
  readonly #endpoint: string;
  readonly #fetcher: ModelFetch;
  readonly #stallTimeoutMs: number;
  readonly #retry: RetryOptions | undefined;
  readonly #region: string | undefined;
  readonly #now: () => Date;

  constructor(provider: Provider, options: ProviderModelClientOptions) {
    this.#provider = provider;
    const platform = platformOf(provider, options.region);
    if (!platform)
      throw new ModelClientError(
        "modelUnavailable",
        `${provider.name} has no platform named "${options.region ?? ""}".`,
      );
    this.#endpoint = options.endpoint ?? platform.endpoint;
    this.#account = new ProviderAccount(options, provider, this.#endpoint);
    this.#fetcher = options.fetcher ?? defaultFetch;
    this.#stallTimeoutMs = options.stallTimeoutMs ?? defaultStallTimeoutMs;
    this.#retry = options.retry;
    this.#region = options.region;
    this.#now = options.now ?? (() => new Date());
  }

  send(request: ModelRequest): AsyncIterable<ModelEvent> {
    return withRetries(() => this.#attempt(request), request, this.#retry);
  }

  async *#attempt(request: ModelRequest): AsyncIterable<ModelEvent> {
    refuseUnavailable(this.#provider);
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
        `Add ${this.#provider.keyName} on the Model page before starting a task.`,
      );
    }
    const price = this.#provider.price?.(chosen.model, this.#region);
    for await (const event of this.#provider.send({
      endpoint: this.#endpoint,
      apiKey,
      chosen,
      request: {
        ...request,
        messages: ownReplaysOnly(request.messages, this.#provider.id),
      },
      fetcher: this.#fetcher,
      stallTimeoutMs: this.#stallTimeoutMs,
    })) {
      // A cost the provider did not report is estimated from its price list.
      const estimated =
        price && event.kind === "usage" && event.usage.costUsd === undefined
          ? estimateCost(price, event.usage, this.#now())
          : undefined;
      yield estimated && event.kind === "usage"
        ? { ...event, usage: { ...event.usage, estimatedCost: estimated } }
        : event;
    }
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
