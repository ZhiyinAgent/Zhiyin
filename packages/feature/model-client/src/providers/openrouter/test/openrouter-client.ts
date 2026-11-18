/**
 * A client bound to OpenRouter alone, for tests that send a request through
 * the production client and parser with the network, key and model
 * descriptions they hand in. The app reaches OpenRouter through
 * `ModelProviders`, which builds the same client for it.
 */

import {
  ProviderModelClient,
  type ProviderModelClientOptions,
} from "../../../client.js";
import { openRouter } from "../provider.js";

export class OpenRouterModelClient extends ProviderModelClient {
  constructor(options: ProviderModelClientOptions) {
    super(openRouter, options);
  }
}
