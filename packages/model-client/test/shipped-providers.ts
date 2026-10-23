/**
 * The providers Zhiyin ships, answering as `ModelProviders` makes them
 * answer: each lab from its part of the model list that ships with this
 * version.
 */

import { answeredFromList } from "../src/model-list.js";
import type { Provider } from "../src/provider.js";
import { everyProvider as declared } from "../src/providers/index.js";
import { shippedModelLists } from "../src/shipped-model-list.js";

export const everyProvider: readonly Provider[] = declared.map((provider) =>
  "listed" in provider
    ? answeredFromList(provider, shippedModelLists)
    : provider,
);

function shipped(id: string): Provider {
  const provider = everyProvider.find((each) => each.id === id);
  if (!provider) throw new Error(`Zhiyin ships no provider "${id}".`);
  return provider;
}

export const anthropic = shipped("anthropic");
export const deepSeek = shipped("deepseek");
export const miniMax = shipped("minimax");
export const mistral = shipped("mistral");
export const moonshot = shipped("moonshot");
export const openAi = shipped("openai");
export const qwen = shipped("qwen");
export const xiaomi = shipped("xiaomi");
export const zai = shipped("zai");
