import type { ProviderTarget } from "./models.js";

/**
 * The model studio work is reviewed on, when the person chose one other than
 * the conversation's (ADR 0024): the provider and region it is reached
 * through, the model, and on a provider that routes, the upstreams that may
 * serve it, empty for any.
 */
export type ReviewerModelChoice = ProviderTarget & {
  readonly model: string;
  readonly providers: readonly string[];
};
