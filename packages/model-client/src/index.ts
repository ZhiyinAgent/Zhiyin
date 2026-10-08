/**
 * Talks to the language model. The provider's wire format does not escape this
 * package — nothing else names a provider-specific field.
 *
 * Boundaries and invariants: docs/architecture/features/model-client/README.md
 */

export * from "./model-client.js";

export {
  ProviderCredentials,
  type CredentialEntry,
  type ProviderCredentialsOptions,
} from "./credentials.js";
export type { RestartingEvent, RetryingEvent, RetryOptions } from "./retry.js";
export {
  ModelClientError,
  type ModelClientErrorCode,
  type ProviderFailureDetail,
  type TokenLimitDetail,
} from "./failures.js";
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
