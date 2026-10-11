/**
 * Every provider the model client can reach, each a folder of its own. This is
 * the one place the shared code reaches them from (ADR 0024).
 */

import type { Provider } from "../provider.js";
import { anthropic } from "./anthropic/provider.js";
import { deepSeek } from "./deepseek/provider.js";
import { miniMax } from "./minimax/provider.js";
import { mistral } from "./mistral/provider.js";
import { moonshot } from "./moonshot/provider.js";
import { openAi } from "./openai/provider.js";
import { openRouter } from "./openrouter/provider.js";
import { qwen } from "./qwen/provider.js";
import { xiaomi } from "./xiaomi/provider.js";
import { zai } from "./zai/provider.js";

/** In the order the person is offered them. */
export const everyProvider: readonly Provider[] = [
  openRouter,
  anthropic,
  openAi,
  zai,
  deepSeek,
  moonshot,
  miniMax,
  xiaomi,
  qwen,
  mistral,
];

/**
 * A choice saved before providers were named was made on OpenRouter, the only
 * provider there was.
 */
export const providerOfUnnamedChoices = openRouter.id;

export {
  OpenRouterModelClient,
  type OpenRouterModelClientOptions,
} from "./openrouter/client.js";
export {
  fetchOpenRouterCatalog,
  fetchOpenRouterModelProviders,
} from "./openrouter/catalog.js";
