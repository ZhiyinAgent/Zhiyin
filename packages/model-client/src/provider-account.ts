/**
 * The account side of the provider: the key, the model and routing chosen,
 * and what the catalogue says about that model. Requests ask it what to send
 * with; Settings asks it what to show.
 */

import type {
  ModelCatalog,
  ModelProviderList,
  ProviderSettings,
  ReasoningCapabilities,
} from "@zhiyin/contract";
import {
  fetchOpenRouterCatalog,
  fetchOpenRouterModelProviders,
  requestWindow,
  type CatalogFetch,
  type CatalogOptions,
} from "./catalog.js";
import type { ModelChoice, ModelChoiceValue } from "./choice.js";
import type { ProviderCredentials } from "./credentials.js";
import { classifyFailure, ModelClientError } from "./failures.js";
import { acceptsImages, reasoningCapabilities } from "./reasoning.js";

export type ProviderAccountOptions = {
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
  /**
   * Which OpenRouter upstreams may serve requests. An empty list lets
   * OpenRouter choose from all of them.
   */
  readonly providers?: readonly string[];
  /** How a key is checked before it is kept. Replaced wholesale in tests. */
  readonly catalogFetch?: CatalogFetch;
};

/**
 * The account behind a key. Chosen for this because it is the endpoint that
 * actually refuses a bad key: the catalogue answers one normally, verified
 * against the live provider.
 */
const keyUrl = "https://openrouter.ai/api/v1/key";

const defaultCatalogFetch: CatalogFetch = (url, init) =>
  fetch(url, {
    headers: init.headers,
    signal: AbortSignal.timeout(15_000),
  });

export class ProviderAccount {
  readonly #modelInfo: ProviderAccountOptions["modelInfo"];
  /** The catalogue's entry for the chosen model, looked up once for every answer. */
  #description: Promise<unknown> | undefined;
  readonly #apiKey: ProviderAccountOptions["apiKey"];
  readonly #credentials: ProviderCredentials | undefined;
  readonly #model: string | undefined;
  readonly #providers: readonly string[];
  readonly #choice: ModelChoice | undefined;
  readonly #catalog: NonNullable<ProviderAccountOptions["catalog"]>;
  /** Cleared when the model changes: both answers are about one model. */
  #describedModel: string | undefined;
  /** Where requests go, for Settings to say. */
  readonly #endpoint: string;
  readonly #catalogFetch: CatalogFetch | undefined;

  constructor(options: ProviderAccountOptions, endpoint: string) {
    this.#modelInfo = options.modelInfo;
    this.#apiKey = options.apiKey;
    this.#credentials = options.credentials;
    this.#model = options.model;
    /*
     * Unrestricted until somebody restricts it (ADR 0010). A default list names
     * upstreams of one model, which serve no other: a model chosen without its
     * own list would be routed to upstreams that do not carry it and refused.
     * Verified live: `inception/mercury-2.5` restricted to `z-ai` was refused
     * 404, and served 200 without the restriction.
     */
    this.#providers = options.providers ?? [];
    this.#choice = options.choice;
    this.#catalog = options.catalog ?? {
      models: fetchOpenRouterCatalog,
      providers: fetchOpenRouterModelProviders,
    };
    this.#endpoint = endpoint;
    this.#catalogFetch = options.catalogFetch;
  }

  /** The key requests are sent with, wherever it is kept. */
  async apiKey(): Promise<string | undefined> {
    return this.#credentials ? this.#credentials.get() : this.#apiKey?.();
  }

  /**
   * The model and routing in force right now. Read on every request rather than
   * captured at construction, so a choice saved mid-session takes effect on the
   * next turn instead of at the next restart.
   */
  async current(): Promise<ModelChoiceValue | undefined> {
    const value = this.#choice
      ? await this.#choice.current()
      : this.#model
        ? { model: this.#model, providers: this.#providers }
        : undefined;
    if (this.#describedModel !== value?.model) {
      this.#describedModel = value?.model;
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

  async reasoning(): Promise<ReasoningCapabilities | undefined> {
    if (!this.#modelInfo || !(await this.current())) return undefined;
    const description = await this.#describe();
    return description.ok
      ? reasoningCapabilities(description.value)
      : {
          status: "unavailable" as const,
          /*
           * Not "restart the app": `#describe` forgets a lookup that failed, so
           * the next question asked about this model tries again. Telling
           * somebody to restart sends them to do something that changes
           * nothing.
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
    const chosen = await this.current();
    if (!this.#modelInfo || !chosen) return { ok: false };
    const lookup = (this.#description ??= this.#modelInfo(chosen.model));
    try {
      return { ok: true, value: await lookup };
    } catch {
      if (this.#description === lookup) this.#description = undefined;
      return { ok: false };
    }
  }

  /** What the catalogue lists of the size of a request to the chosen model. */
  async #window(chosen: ModelChoiceValue) {
    const described = await this.#describe();
    return requestWindow(
      await this.#catalog
        .providers(chosen.model, this.#catalogOptions())
        .catch(() => undefined),
      chosen.providers,
      described.ok ? described.value : undefined,
    );
  }

  async settings(): Promise<ProviderSettings> {
    const chosen = await this.current();
    const reasoning = await this.reasoning();
    const credential = this.#credentials
      ? await this.#credentials.status()
      : (await this.#apiKey?.())
        ? ({ status: "configured", source: "environment" } as const)
        : ({ status: "missing", source: "none" } as const);
    const window = chosen ? await this.#window(chosen) : {};
    return {
      ...(reasoning ? { reasoning } : {}),
      acceptsImages: await this.#acceptsImages(),
      ...window,
      ...(chosen ? { model: chosen.model } : {}),
      providers: [...(chosen?.providers ?? [])],
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
      /*
       * The account endpoint refuses nothing but the key, so any refusal here
       * is about the key - including a 403 that on a model request would be a
       * moderation block.
       */
      return {
        accepted: false,
        error:
          response.status === 401 || response.status === 403
            ? new ModelClientError(
                "unauthorized",
                "OpenRouter rejected the API key.",
              )
            : classifyFailure({ status: response.status }),
      };
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
