import type { ReasoningCapabilities } from "./reasoning.js";

/**
 * One model the provider offers. Only models that can call tools are ever
 * listed: an agent that cannot call a tool cannot run this app, so a model
 * without them is not a degraded choice but an unusable one.
 */
export type ModelCatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
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

export type ProviderSettings = {
  readonly reasoning?: ReasoningCapabilities;
  /**
   * Whether this model can be shown a picture. False when unknown: an action
   * that can only answer in pictures is withdrawn rather than offered blind.
   */
  readonly acceptsImages?: boolean;
  readonly model: string;
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
  readonly credential:
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
};
