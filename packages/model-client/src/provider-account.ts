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
import type { ModelChoice, ModelChoiceValue } from "./choice.js";
import type { KeptApiKey } from "./model-client.js";
import type { ProviderCredentials } from "./credentials.js";
import { ModelClientError, withoutKey } from "./failures.js";
import { catalogFetch } from "./keyed-fetch.js";
import {
  refuseUnavailable,
  type CatalogFetch,
  type CatalogOptions,
  type KeyCheck,
  type Provider,
} from "./provider.js";

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
   * Which upstreams may serve requests, where the provider routes between
   * several. An empty list lets the provider choose from all of them.
   */
  readonly providers?: readonly string[];
  /** How a key is checked and lists are read. Replaced wholesale in tests. */
  readonly catalogFetch?: CatalogFetch;
  /** The platform the account is on, where the provider runs two. */
  readonly region?: string;
};

/**
 * Why a model's reasoning settings are not known, when looking them up
 * failed. Not "restart the app": a lookup that failed is forgotten, so the
 * next question asked about this model, or the same request sent again, tries
 * again. Telling somebody to restart sends them to do something that changes
 * nothing.
 */
const reasoningNotLoaded =
  "Reasoning settings could not be loaded. They are read again the next time they are needed.";

/** The catalogue's entry for the chosen model, when the lookup answered. */
type Description =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false };

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
  readonly #provider: Provider;
  /** Where requests go, for Settings to say. */
  readonly #endpoint: string;
  readonly #catalogFetch: CatalogFetch | undefined;
  readonly #region: string | undefined;

  constructor(
    options: ProviderAccountOptions,
    provider: Provider,
    endpoint: string,
  ) {
    this.#provider = provider;
    this.#modelInfo = options.modelInfo;
    this.#apiKey = options.apiKey;
    this.#credentials = options.credentials;
    this.#model = options.model;
    /*
     * Unrestricted until somebody restricts it (ADR 0015). A default list names
     * upstreams of one model, which serve no other: a model chosen without its
     * own list would be routed to upstreams that do not carry it and refused.
     * Verified live: `inception/mercury-2.5` restricted to `z-ai` was refused
     * 404, and served 200 without the restriction.
     */
    this.#providers = options.providers ?? [];
    this.#choice = options.choice;
    this.#catalog = options.catalog ?? provider.catalogue;
    this.#endpoint = endpoint;
    this.#catalogFetch = options.catalogFetch;
    this.#region = options.region;
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
      ...(this.#region ? { region: this.#region } : {}),
      ...(this.#catalogFetch ? { fetcher: this.#catalogFetch } : {}),
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
    refuseUnavailable(this.#provider);
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

  async reasoning(): Promise<ReasoningCapabilities | undefined> {
    if (!this.#modelInfo || !(await this.current())) return undefined;
    return this.#reasoningOf(await this.#describe());
  }

  #reasoningOf(description: Description): ReasoningCapabilities {
    return description.ok
      ? this.#provider.reasoning(description.value)
      : {
          status: "unavailable" as const,
          reason: reasoningNotLoaded,
          lookupFailed: true as const,
        };
  }

  /**
   * The catalogue's entry for the chosen model. One lookup answers every
   * question asked about the model; a lookup that failed is forgotten, so the
   * next question asks again.
   */
  async #describe(): Promise<Description> {
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
  async #window(chosen: ModelChoiceValue, described: Description) {
    return this.#provider.window(
      await this.#catalog
        .providers(chosen.model, this.#catalogOptions())
        .catch(() => undefined),
      chosen.providers,
      described.ok ? described.value : undefined,
    );
  }

  /**
   * One lookup answers the whole read, so it never says half of what one
   * lookup found and half of what the next did. A lookup that failed is said
   * to have failed: false about pictures then means not known, not cannot.
   */
  async settings(): Promise<ProviderSettings> {
    const chosen = await this.current();
    const described: Description = chosen
      ? await this.#describe()
      : { ok: false };
    const credential = this.#credentials
      ? await this.#credentials.status()
      : (await this.#apiKey?.())
        ? ({ status: "configured", source: "environment" } as const)
        : ({ status: "missing", source: "none" } as const);
    const window = chosen ? await this.#window(chosen, described) : {};
    const lookedUp = Boolean(this.#modelInfo && chosen);
    return {
      ...(lookedUp ? { reasoning: this.#reasoningOf(described) } : {}),
      // Read from the catalogue rather than from the model's name: within one
      // family the answer differs from version to version.
      acceptsImages:
        described.ok && this.#provider.acceptsImages(described.value),
      ...(lookedUp && !described.ok ? { lookupFailed: true as const } : {}),
      ...window,
      ...(this.#provider.reasoningSentBack ? { reasoningSentBack: true } : {}),
      ...(chosen ? { model: chosen.model } : {}),
      providers: [...(chosen?.providers ?? [])],
      endpoint: this.#endpoint,
      credential,
    };
  }

  /**
   * Checks a key with the provider before keeping it, in whatever way the
   * provider actually refuses a bad key. A key that is refused is never
   * stored: storing it would turn one mistake at setup into a failure
   * somewhere else later, saying something else, with nothing pointing back at
   * the key.
   *
   * A check that could not be made is not a refusal. Somebody offline has not
   * typed the wrong key and must not be told they have, so the key is kept and
   * the trouble is named for what it is.
   */
  async setApiKey(pasted: string): Promise<KeptApiKey> {
    if (!this.#credentials) {
      throw new ModelClientError(
        "credentialUnavailable",
        "Secure key storage is unavailable.",
      );
    }
    // One value for the check, the hiding and the store.
    const apiKey = pasted.trim();
    const checked = await this.#checkApiKey(apiKey);
    await this.#credentials.set(apiKey);
    return checked;
  }

  /**
   * Throws the provider's refusal of the key. A provider that was busy or
   * failed on its own side, which sending again could get past, said nothing
   * about the key: that check could not be made.
   */
  async #checkApiKey(apiKey: string): Promise<KeptApiKey> {
    const fetcher = this.#catalogFetch ?? catalogFetch;
    const unchecked: KeptApiKey = {
      status: "unverified",
      reason: `The key was saved but could not be checked with ${this.#provider.name}. If it turns out to be wrong, requests will say so.`,
    };
    let checked: KeyCheck;
    try {
      checked = await this.#provider.checkKey(apiKey, fetcher, this.#region);
    } catch {
      return unchecked;
    }
    if (checked.accepted) return { status: "accepted" };
    if (checked.error.retryable) return unchecked;
    throw withoutKey(checked.error, apiKey);
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
