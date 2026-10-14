/**
 * What the shared client needs from a provider. Each provider is a folder of
 * its own under `providers/`, and answers these in its own terms; nothing here
 * names one (ADR 0024).
 */

import type {
  ModelCatalog,
  ModelPrice,
  ModelProviderList,
  ProviderPages,
  ReasoningCapabilities,
} from "@zhiyin/contract";
import type { ModelChoiceValue } from "./choice.js";
import { ModelClientError } from "./failures.js";
import type { ModelEvent, ModelFetch, ModelRequest } from "./model-client.js";

/**
 * How a provider's lists and account are read. Replaced wholesale in tests.
 * A GET unless `method` says otherwise: a provider with no endpoint that
 * checks a key posts the cheapest request that proves one.
 */
export type CatalogFetch = (
  url: string,
  init: {
    readonly headers: Readonly<Record<string, string>>;
    readonly method?: "POST";
    readonly body?: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export type CatalogOptions = {
  readonly apiKey?: () => Promise<string | undefined>;
  readonly fetcher?: CatalogFetch;
  readonly timeoutMs?: number;
  /** The platform asked, where the provider runs two. */
  readonly region?: string;
};

/** One request, with everything about where and how it goes settled. */
export type SendInput = {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly chosen: ModelChoiceValue;
  readonly request: ModelRequest;
  readonly fetcher: ModelFetch;
  readonly stallTimeoutMs: number;
};

/** The size a request to one model must fit, where something lists it. */
type RequestWindow = {
  readonly contextWindow?: number;
  readonly maximumOutputTokens?: number;
};

/**
 * What a provider said about a key offered to it. A refusal carries the
 * failure to report; a check that could not be made throws instead. A refusal
 * that sending again could get past, such as a busy provider, is taken as a
 * check that could not be made.
 */
export type KeyCheck =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly error: ModelClientError };

/**
 * One of two platforms a lab runs, international or mainland China. Each
 * keeps its own accounts and keys, and may have its own host.
 */
export type ProviderRegion = {
  /** Stable, never shown: names the region in stored choices and keys. */
  readonly id: string;
  readonly name: string;
  /**
   * The variable that supplies its key to an automated run, where it is not
   * the provider's: each platform has a variable of its own.
   */
  readonly keyVariable?: string;
  /** Where its requests go unless the environment says otherwise. */
  readonly endpoint: string;
  /** Where its accounts' keys and billing are managed. */
  readonly pages: ProviderPages;
};

/**
 * Where a provider's requests go and its accounts are managed: one platform,
 * or one per region.
 */
type Platforms =
  | {
      readonly endpoint: string;
      readonly pages: ProviderPages;
      readonly regions?: never;
    }
  | {
      readonly endpoint?: never;
      readonly pages?: never;
      readonly regions: readonly ProviderRegion[];
    };

export type Provider = Platforms & {
  /** Stable, never shown: names the provider in stored choices and keys. */
  readonly id: string;
  /** How the person reads the provider's name. */
  readonly name: string;
  /** The key as the person is asked for it, such as "an OpenRouter API key". */
  readonly keyName: string;
  /**
   * The variable that supplies a key to an automated run, such as a test of
   * the installed app. Its name starts with ZHIYIN_ so that no variable set
   * for another tool is ever taken for a key a person saves here.
   */
  readonly keyVariable: string;
  /**
   * Earlier turns go back to this provider with their reasoning, so it counts
   * toward each request's size.
   */
  readonly reasoningSentBack?: true;
  /** It routes each model to upstreams the person may choose between. */
  readonly upstreams?: true;
  /**
   * Why the provider cannot be used yet. A provider whose path has not been
   * shown to work is listed with this and sent nothing.
   */
  readonly unavailable?: string;
  /**
   * How long its answer may take to start, from the request being sent to
   * the first byte back, before the request is given up as a connection that
   * never answered. Set only where its answers were measured to start well
   * inside it; without it, the silence a stream may keep is waited.
   */
  readonly startTimeoutMs?: number;
  send(input: SendInput): AsyncIterable<ModelEvent>;
  readonly catalogue: {
    models(options: CatalogOptions): Promise<ModelCatalog>;
    providers(
      model: string,
      options: CatalogOptions,
    ): Promise<ModelProviderList>;
  };
  /**
   * What the provider says about one model, read by `window`, `reasoning`
   * and `acceptsImages`. Undefined when it lists no such model.
   */
  describe(model: string, options: CatalogOptions): Promise<unknown>;
  /** The window a request must fit, from what the catalogue listed. */
  window(
    listed: ModelProviderList | undefined,
    picked: readonly string[],
    described: unknown,
  ): RequestWindow;
  /** The reasoning controls a model's catalogue entry offers. */
  reasoning(described: unknown): ReasoningCapabilities;
  /** Whether a model's catalogue entry says it takes pictures. */
  acceptsImages(described: unknown): boolean;
  /**
   * The model's price on one of the provider's platforms, for a request whose
   * cost the provider does not report. Absent where it reports every cost.
   */
  price?(model: string, region?: string): ModelPrice | undefined;
  /** Asks the provider about a key for one of its platforms. */
  checkKey(
    apiKey: string,
    fetcher: CatalogFetch,
    region?: string,
  ): Promise<KeyCheck>;
};

/**
 * The region of a provider named by `region`, or the provider's one platform
 * when it has no regions. Undefined when the two do not match.
 */
export function platformOf(
  provider: Provider,
  region: string | undefined,
):
  | {
      readonly endpoint: string;
      readonly pages: ProviderPages;
      readonly region?: ProviderRegion;
    }
  | undefined {
  if (!provider.regions)
    return region === undefined
      ? { endpoint: provider.endpoint, pages: provider.pages }
      : undefined;
  const found = provider.regions.find((each) => each.id === region);
  return found
    ? { endpoint: found.endpoint, pages: found.pages, region: found }
    : undefined;
}

/**
 * A provider whose path has not been shown to work is sent nothing, and
 * nothing is chosen on it.
 */
export function refuseUnavailable(provider: Provider): void {
  if (provider.unavailable)
    throw new ModelClientError(
      "modelUnavailable",
      `${provider.name} cannot be used yet. ${provider.unavailable}`,
    );
}
