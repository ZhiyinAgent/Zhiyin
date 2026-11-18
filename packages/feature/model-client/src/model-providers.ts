/**
 * The client a conversation talks to. It follows the person's choice of
 * provider, region and model on every request, and keeps one account (key,
 * models, choice) per provider and region, so a key or a model is set up for
 * the provider it was offered to whichever one is chosen (ADR 0014).
 */

import type {
  ModelCatalog,
  ModelProviderList,
  ProviderPages,
  ProviderSettings,
  ProviderSummary,
  ProviderTarget,
} from "@zhiyin/contract";
import type { ModelChoice, ModelChoiceValue } from "./choice.js";
import { ProviderModelClient } from "./client.js";
import { ProviderCredentials, type CredentialEntry } from "./credentials.js";
import { ModelClientError } from "./failures.js";
import { catalogFetchOver, keyedFetch, type Network } from "./keyed-fetch.js";
import type {
  KeptApiKey,
  ModelClient,
  ModelEvent,
  ModelFetch,
  ModelFetchResponse,
  ModelRequest,
  ModelUsage,
  ProviderDirectory,
  UncountedUsage,
} from "./model-client.js";
import { answeredFromList, type ModelLists } from "./model-list.js";
import {
  platformOf,
  type CatalogFetch,
  type Provider,
  type ProviderDefinition,
} from "./provider.js";
import { everyProvider } from "./providers/index.js";
import { recentReads } from "./recent-reads.js";
import type { RetryOptions } from "./retry.js";
import { shippedModelLists } from "./shipped-model-list.js";

export type ModelProvidersOptions = {
  /** The person's choice, kept on disk. Absent when `fixed` sets it. */
  readonly choice?: ModelChoice;
  /**
   * A choice fixed for a run, such as a benchmark's, on the first provider
   * offered where it names none. Nothing can change it, and no other
   * provider has a model.
   */
  readonly fixed?: {
    readonly provider?: string;
    readonly region?: string;
    readonly model: string;
  };
  /** Reads an environment variable: a key supplied to an automated run. */
  readonly environment: (variable: string) => string | undefined;
  /** The credential store's entry for one account. Replaced in tests. */
  readonly credentialEntry?: (account: string) => CredentialEntry;
  /**
   * Where every request goes instead of the provider's host, during
   * development. It lists no models, so none are looked up.
   */
  readonly endpoint?: string;
  /**
   * How every request goes online: answers, key checks, listings and model
   * descriptions. Node's own `fetch` when absent (ADR 0004).
   */
  readonly network?: Network;
  /** Answers alone, in place of `network`. Replaced in tests. */
  readonly fetcher?: ModelFetch;
  /** Key checks and listings alone, in place of `network`. Replaced in tests. */
  readonly catalogFetch?: CatalogFetch;
  readonly stallTimeoutMs?: number;
  readonly retry?: RetryOptions;
  /** Every provider that can be reached. Replaced in tests. */
  readonly providers?: readonly ProviderDefinition[];
  /**
   * The model list in force, which the labs answer from: the one shipped
   * with this version when absent (ADR 0027).
   */
  readonly modelLists?: ModelLists;
};

type Target = { readonly provider: Provider; readonly region?: string };

/** A provider's own pages, or its first platform's where it runs several. */
function pagesOf(provider: Provider): ProviderPages {
  const pages = provider.pages ?? provider.regions?.[0]?.pages;
  if (!pages) throw new Error(`${provider.name} names no pages.`);
  return pages;
}

/** The name a key is stored under: the provider's, and its region's where it has regions. */
const accountOf = ({ provider, region }: Target) =>
  region ? `${provider.id}:${region}` : provider.id;

export class ModelProviders implements ModelClient, ProviderDirectory {
  readonly #options: ModelProvidersOptions;
  readonly #providers: readonly Provider[];
  readonly #fixed: Target | undefined;
  /** The account that answers, with no model, while nothing is chosen. */
  readonly #unchosen: Target;
  readonly #credentials = new Map<string, ProviderCredentials>();
  readonly #clients = new Map<string, ModelClient>();
  /** Clients for a model chosen for one purpose, by account and choice. */
  readonly #chosenFor = new Map<string, ModelClient>();

  constructor(options: ModelProvidersOptions) {
    this.#options = options;
    const lists = options.modelLists ?? shippedModelLists;
    this.#providers = (options.providers ?? everyProvider).map((provider) =>
      "listed" in provider ? answeredFromList(provider, lists) : provider,
    );
    const first = this.#providers[0];
    if (!first) throw new Error("There is no provider to reach.");
    const firstRegion = first.regions?.[0]?.id;
    this.#unchosen = firstRegion
      ? { provider: first, region: firstRegion }
      : { provider: first };
    if (options.fixed) {
      this.#fixed = this.#target({
        ...options.fixed,
        provider: options.fixed.provider ?? first.id,
      });
      if (!this.#fixed)
        throw new ModelClientError(
          "modelUnavailable",
          `The fixed model choice names no provider and region Zhiyin can reach: "${options.fixed.provider ?? ""}" "${options.fixed.region ?? ""}".`,
        );
    }
  }

  /**
   * The provider and region a stored choice names, if Zhiyin can reach it.
   * One that names no provider names nothing.
   */
  #target(
    value: Pick<ModelChoiceValue, "provider" | "region">,
  ): Target | undefined {
    const provider = this.#providers.find((each) => each.id === value.provider);
    if (!provider || !platformOf(provider, value.region)) return undefined;
    return value.region ? { provider, region: value.region } : { provider };
  }

  /**
   * Who requests go to now: read on every request, so a choice saved
   * mid-session takes effect on the next one. With no choice, or one naming a
   * provider Zhiyin cannot reach, it is the first provider's account with no
   * model.
   */
  async #chosen(): Promise<Target> {
    if (this.#fixed) return this.#fixed;
    const value = await this.#options.choice?.current();
    return (value && this.#target(value)) ?? this.#unchosen;
  }

  /** The person's choice as one provider and region sees it. */
  #choiceFor(target: Target, choice: ModelChoice): ModelChoice {
    const account = accountOf(target);
    return {
      current: async () => {
        const value = await choice.current();
        const named = value && this.#target(value);
        return named && accountOf(named) === account
          ? { model: value.model, providers: value.providers }
          : undefined;
      },
      set: (value) =>
        choice.set({
          provider: target.provider.id,
          ...(target.region ? { region: target.region } : {}),
          model: value.model,
          providers: value.providers,
        }),
    };
  }

  #keys(target: Target): ProviderCredentials {
    const account = accountOf(target);
    let credentials = this.#credentials.get(account);
    if (!credentials) {
      const entry = this.#options.credentialEntry;
      const variable =
        platformOf(target.provider, target.region)?.region?.keyVariable ??
        target.provider.keyVariable;
      credentials = new ProviderCredentials({
        environment: () => this.#options.environment(variable),
        account,
        keyName: target.provider.keyName,
        ...(entry ? { entries: entry } : {}),
      });
      this.#credentials.set(account, credentials);
    }
    return credentials;
  }

  #client(target: Target, own?: ModelChoice): ModelClient {
    const account = accountOf(target);
    let client = own ? undefined : this.#clients.get(account);
    if (client) return client;
    const { provider, region } = target;
    const credentials = this.#keys(target);
    const options = this.#options;
    const fixed = this.#fixed && accountOf(this.#fixed) === account;
    const { network } = options;
    const fetcher =
      options.fetcher ??
      (network
        ? (url: string, init: Parameters<ModelFetch>[1]) =>
            keyedFetch(url, init, network) as Promise<ModelFetchResponse>
        : undefined);
    // The account's lists and the description of its model share one read.
    const catalogFetch = recentReads(
      options.catalogFetch ?? catalogFetchOver(network),
    );
    client = new ProviderModelClient(provider, {
      credentials,
      ...(region ? { region } : {}),
      ...(own
        ? { choice: own }
        : options.fixed
          ? fixed
            ? { model: options.fixed.model }
            : {}
          : options.choice
            ? { choice: this.#choiceFor(target, options.choice) }
            : {}),
      ...(options.endpoint
        ? { endpoint: options.endpoint }
        : {
            modelInfo: (model: string) =>
              provider.describe(model, {
                apiKey: () => credentials.get(),
                ...(region ? { region } : {}),
                fetcher: catalogFetch,
              }),
          }),
      ...(fetcher ? { fetcher } : {}),
      catalogFetch,
      ...(options.stallTimeoutMs !== undefined
        ? { stallTimeoutMs: options.stallTimeoutMs }
        : {}),
      ...(options.retry ? { retry: options.retry } : {}),
    });
    if (!own) this.#clients.set(account, client);
    return client;
  }

  withModel(
    target: ProviderTarget,
    value: Pick<ModelChoiceValue, "model" | "providers">,
  ): ModelClient {
    const found = this.#reachable(target);
    const key = JSON.stringify([
      accountOf(found),
      value.model,
      value.providers,
    ]);
    const kept = this.#chosenFor.get(key);
    if (kept) return kept;
    const client = this.#client(found, {
      current: async () => ({ model: value.model, providers: value.providers }),
      set: async () => {
        throw new ModelClientError(
          "modelUnavailable",
          "This model was chosen for one purpose and is changed where it was chosen.",
        );
      },
    });
    const chosen: ModelClient = {
      send: (request) => client.send(request),
      uncounted: async (usage) => client.uncounted?.(usage),
      settings: () => this.#settingsOf(found, client),
      setApiKey: (apiKey) => client.setApiKey(apiKey),
      clearApiKey: () => client.clearApiKey(),
      models: () => client.models(),
      modelProviders: (model) => client.modelProviders(model),
      selectModel: (model, providers) => client.selectModel(model, providers),
    };
    this.#chosenFor.set(key, chosen);
    return chosen;
  }

  #reachable(target: ProviderTarget): Target {
    const found = this.#target(target);
    if (!found)
      throw new ModelClientError(
        "modelUnavailable",
        `Zhiyin cannot reach "${target.provider}"${target.region ? ` in "${target.region}"` : ""}.`,
      );
    return found;
  }

  for(target: ProviderTarget): ModelClient {
    return this.#client(this.#reachable(target));
  }

  async list(): Promise<readonly ProviderSummary[]> {
    return Promise.all(
      this.#providers.map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        ...(provider.unavailable ? { unavailable: provider.unavailable } : {}),
        ...(provider.upstreams ? { upstreams: true as const } : {}),
        accounts: await Promise.all(
          (provider.regions ?? [undefined]).map(async (region) => ({
            ...(region ? { region: { id: region.id, name: region.name } } : {}),
            credential: await this.#keys({
              provider,
              ...(region ? { region: region.id } : {}),
            }).status(),
            pages: region ? region.pages : pagesOf(provider),
          })),
        ),
      })),
    );
  }

  async *send(request: ModelRequest): AsyncIterable<ModelEvent> {
    yield* this.#client(await this.#chosen()).send(request);
  }

  async uncounted(usage: UncountedUsage): Promise<ModelUsage | undefined> {
    return this.#client(await this.#chosen()).uncounted?.(usage);
  }

  async settings(): Promise<ProviderSettings> {
    const target = await this.#chosen();
    return this.#settingsOf(target, this.#client(target));
  }

  async #settingsOf(
    target: Target,
    client: ModelClient,
  ): Promise<ProviderSettings> {
    const platform = platformOf(target.provider, target.region);
    const region = platform?.region;
    return {
      provider: {
        id: target.provider.id,
        name: target.provider.name,
        ...(region ? { region: { id: region.id, name: region.name } } : {}),
        pages: platform?.pages ?? pagesOf(target.provider),
        ...(target.provider.upstreams ? { upstreams: true as const } : {}),
      },
      ...(await client.settings()),
    };
  }

  async setApiKey(apiKey: string): Promise<KeptApiKey> {
    return this.#client(await this.#chosen()).setApiKey(apiKey);
  }

  async clearApiKey(): Promise<void> {
    return this.#client(await this.#chosen()).clearApiKey();
  }

  async models(): Promise<ModelCatalog> {
    return this.#client(await this.#chosen()).models();
  }

  async modelProviders(model: string): Promise<ModelProviderList> {
    return this.#client(await this.#chosen()).modelProviders(model);
  }

  async selectModel(
    model: string,
    providers: readonly string[],
  ): Promise<void> {
    return this.#client(await this.#chosen()).selectModel(model, providers);
  }
}
