import {
  ProviderModelClient,
  type ProviderModelClientOptions,
} from "../../client.js";
import { openRouter } from "./provider.js";

export type OpenRouterModelClientOptions = ProviderModelClientOptions;

/** The client bound to OpenRouter alone. */
export class OpenRouterModelClient extends ProviderModelClient {
  constructor(options: OpenRouterModelClientOptions) {
    super(openRouter, options);
  }
}
