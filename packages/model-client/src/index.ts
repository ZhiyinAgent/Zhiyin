/**
 * Talks to the language model. The provider's wire format does not escape this
 * package — nothing else names a provider-specific field.
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
export type { CatalogFetch, CatalogOptions } from "./provider.js";
export {
  fetchOpenRouterCatalog,
  fetchOpenRouterModelProviders,
  OpenRouterModelClient,
  type OpenRouterModelClientOptions,
} from "./providers/index.js";
export {
  ModelProviders,
  type ModelProvidersOptions,
} from "./model-providers.js";
export {
  FileModelChoice,
  ModelChoiceError,
  type ModelChoice,
  type ModelChoiceValue,
} from "./choice.js";
