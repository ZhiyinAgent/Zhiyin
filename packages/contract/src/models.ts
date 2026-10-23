import type { ReasoningCapabilities } from "./reasoning.js";

/** Prices per million tokens, in the currency of the list they belong to. */
export type TokenPrices = {
  /** Input the provider did not read from its cache. */
  readonly input: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly output: number;
};

/**
 * A lab's own price for a model on one of its platforms, from Zhiyin's model
 * list. A token kind with no price is unknown, never free.
 */
export type ModelPrice = TokenPrices & {
  /** ISO 4217: `USD`, or `CNY` on a mainland China platform. */
  readonly currency: string;
  /**
   * Higher prices for a request whose input passes a size. The whole request
   * pays the highest tier it passes.
   */
  readonly tiers?: readonly (TokenPrices & {
    readonly aboveInputTokens: number;
  })[];
  /**
   * Prices during the lab's busy hours: on these days (0 is Sunday), from the
   * first hour up to the second, both in UTC. They replace any tier.
   */
  readonly peak?: TokenPrices & {
    readonly weekdaysUtc: readonly number[];
    readonly hoursUtc: readonly (readonly [number, number])[];
  };
  /** The day the price list was checked against the lab's own page. */
  readonly checked: string;
};

/** An amount of money in one currency, named by its ISO 4217 code. */
export type MoneyAmount = {
  readonly amount: number;
  readonly currency: string;
};

/**
 * What a request is estimated to have cost, from the model list's prices,
 * where the provider reported no cost. Never converted to another currency.
 */
export type EstimatedCost = MoneyAmount & {
  /** The day the price list it came from was checked. */
  readonly priceList: string;
};

/**
 * A look for a newer model list, and what came of it: a newer one taken, none
 * newer, or one that could not be read or trusted, which leaves the list in
 * force as it was.
 */
export type ModelListCheck = {
  /** When it ended, as an ISO time. */
  readonly at: string;
} & (
  | { readonly outcome: "updated" | "unchanged" }
  | { readonly outcome: "failed"; readonly reason: string }
);

/**
 * Zhiyin's model list as it stands (ADR 0031): the one the labs' models and
 * prices come from, and whether newer ones are read from GitHub.
 */
export type ModelListState = {
  /** Shipped with this version, or downloaded from GitHub since. */
  readonly source: "shipped" | "downloaded";
  readonly version: number;
  /** The day the list in force was published. */
  readonly published: string;
  /** Whether newer lists are read from GitHub. */
  readonly updates: boolean;
  /** The last look for a newer list since Zhiyin started, if one ended. */
  readonly lastCheck?: ModelListCheck;
};

/**
 * One model the provider offers. Only models that can call tools are ever
 * listed: an agent that cannot call a tool cannot run this app, so a model
 * without them is not a degraded choice but an unusable one.
 */
export type ModelCatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  /** OpenRouter's listed price, in US dollars per million tokens. */
  readonly inputUsdPerMillion?: number;
  readonly outputUsdPerMillion?: number;
  /** A lab's own price on the account's platform, where its list states one. */
  readonly price?: ModelPrice;
  readonly acceptsImages: boolean;
  readonly reasoning: boolean;
};

/**
 * One upstream that serves a model. `slug` is what routing is expressed in and
 * includes the variant suffix, so a specific quantization of a specific
 * provider is addressable.
 *
 * Measurements are nullable because the provider publishes them only for
 * models with recent traffic, and only to an authenticated caller. Absent is
 * absent: it is never reported as zero.
 */
export type ModelProviderOption = {
  readonly slug: string;
  readonly name: string;
  readonly quantization: string | null;
  /**
   * A provider's discounted or faster tier of the same model, when this is
   * one: flex is cheaper and slower and fails rather than waits when busy;
   * priority is faster and costs more.
   */
  readonly tier: "flex" | "priority" | null;
  /** Where it runs, when the provider offers the model in more than one. */
  readonly region: string | null;
  readonly contextWindow: number;
  /** The longest reply this upstream gives; null when it does not say. */
  readonly maximumOutputTokens: number | null;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly acceptsTools: boolean;
  readonly responseMs: number | null;
  readonly tokensPerSecond: number | null;
  readonly uptimePercent: number | null;
};

export type ModelCatalog =
  | { readonly status: "ready"; readonly models: readonly ModelCatalogEntry[] }
  | { readonly status: "unavailable"; readonly reason: string };

export type ModelProviderList =
  | {
      readonly status: "ready";
      readonly model: string;
      readonly providers: readonly ModelProviderOption[];
    }
  | { readonly status: "unavailable"; readonly reason: string };

/**
 * What became of a key that was offered. `unverified` is not a refusal: the key
 * is stored and the check could not be made, which is what somebody offline
 * should be told rather than that their key is wrong.
 */
export type ApiKeySaveOutcome =
  | { readonly status: "accepted" }
  | { readonly status: "refused"; readonly reason: string }
  | { readonly status: "unverified"; readonly reason: string };

/**
 * Where requests go: OpenRouter or a lab's own API, and the region of the
 * lab's platform where it runs an international and a mainland China one.
 */
export type ProviderTarget = {
  readonly provider: string;
  readonly region?: string;
};

export type ProviderRegion = { readonly id: string; readonly name: string };

/** Where a person manages their account on a provider's platform. */
export type ProviderPages = {
  /** Where its keys are made and deleted. */
  readonly keys: string;
  /** Where its balance is topped up or its billing kept. */
  readonly billing: string;
};

export type ProviderCredential =
  | {
      readonly status: "configured";
      readonly source: "environment" | "credentialStore";
    }
  | { readonly status: "missing"; readonly source: "none" }
  | {
      readonly status: "unavailable";
      readonly source: "credentialStore";
      readonly reason: string;
    };

/** One provider the person may reach models through, and their keys for it. */
export type ProviderSummary = {
  readonly id: string;
  readonly name: string;
  /** Why it cannot be used yet. Absent once its path works. */
  readonly unavailable?: string;
  /** It routes each model to upstreams the person may choose between. */
  readonly upstreams?: true;
  /**
   * One per platform a person holds an account on, each with its own key:
   * a region each where the lab runs two, otherwise one without a region.
   */
  readonly accounts: readonly {
    readonly region?: ProviderRegion;
    readonly credential: ProviderCredential;
    readonly pages: ProviderPages;
  }[];
};

export type ProviderSettings = {
  /** Who requests go to, and the region of its platform where it has two. */
  readonly provider?: {
    readonly id: string;
    readonly name: string;
    readonly region?: ProviderRegion;
    readonly pages: ProviderPages;
    /** It routes each model to upstreams the person may choose between. */
    readonly upstreams?: true;
  };
  readonly reasoning?: ReasoningCapabilities;
  /**
   * Whether this model can be shown a picture. False when unknown: an action
   * that can only answer in pictures is withdrawn rather than offered blind.
   */
  readonly acceptsImages?: boolean;
  /**
   * The chosen model's catalogue entry could not be looked up, or has not
   * been yet, so what it accepts and how it reasons are not known yet:
   * `acceptsImages` is false for that reason alone. Read again, they may be
   * whole.
   */
  readonly lookupFailed?: true;
  /** Absent until the person chooses one: nobody chooses for them. */
  readonly model?: string;
  /** The catalogue's name for the selected model, when the catalogue answered. */
  readonly modelName?: string;
  /**
   * The window the next request must fit, and the longest reply it may get:
   * the smallest among the upstreams it may be routed to. Absent when nothing
   * lists them; never guessed.
   */
  readonly contextWindow?: number;
  readonly maximumOutputTokens?: number;
  /**
   * Earlier turns go back to this provider with their reasoning, which then
   * counts toward each request's size.
   */
  readonly reasoningSentBack?: boolean;
  /**
   * Set when the window was lowered below the catalogue's because the provider
   * refused a request this large as too long.
   */
  readonly refusedTokens?: number;
  /**
   * The upstreams routing is restricted to. Absent or empty means unrestricted,
   * which is the default: a single upstream has no recovery when it is busy.
   */
  readonly providers?: readonly string[];
  readonly endpoint: string;
  readonly credential: ProviderCredential;
};
