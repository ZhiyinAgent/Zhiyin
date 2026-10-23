/**
 * OpenRouter: one key reaches hundreds of models from many upstreams, over
 * Chat Completions. The person may restrict which upstreams serve a model
 * (ADR 0015); the conversation is sent as `session_id`, so its requests stay
 * with the upstream holding its cache.
 */

import { OPENROUTER_CREDITS_URL, OPENROUTER_KEYS_URL } from "@zhiyin/contract";
import type { ModelChoiceValue } from "../../choice.js";
import { ModelClientError } from "../../failures.js";
import type { ModelRequest } from "../../model-client.js";
import type { CatalogFetch, KeyCheck, Provider } from "../../provider.js";
import {
  acceptsImages,
  fetchOpenRouterModelInfo,
  reasoningCapabilities,
} from "./reasoning.js";
import {
  chatMessages,
  chatTools,
} from "../../wires/chat-completions/messages.js";
import {
  sendChatCompletions,
  type ChatCompletionsDialect,
} from "../../wires/chat-completions/send.js";
import {
  fetchOpenRouterCatalog,
  fetchOpenRouterModelProviders,
  requestWindow,
} from "./catalog.js";
import { classifyFailure } from "./failures.js";

const dialect: ChatCompletionsDialect = {
  name: "OpenRouter",
  headers: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": "Zhiyin",
  }),
  /*
   * `cacheAfter` names the messages a later request is expected to repeat up
   * to, and they are marked for every model. Some upstreams reuse only what
   * is marked (Anthropic, Alibaba's Qwen, Google's Gemini); for the others
   * tried, a mark changed nothing or made reuse more likely (probe of 18
   * routes, 2026-10-19).
   */
  body: (chosen: ModelChoiceValue, request: ModelRequest) => ({
    model: chosen.model,
    stream: true,
    messages: chatMessages(request.messages, request.cacheAfter),
    ...(request.session ? { session_id: request.session } : {}),
    ...(chosen.providers.length
      ? {
          provider: {
            only: [...chosen.providers],
            order: [...chosen.providers],
          },
        }
      : {}),
    ...(request.maximumOutputTokens !== undefined
      ? { max_tokens: request.maximumOutputTokens }
      : {}),
    ...(request.reasoning ? { reasoning: request.reasoning } : {}),
    ...(request.tools?.length ? { tools: chatTools(request.tools) } : {}),
  }),
  classify: classifyFailure,
  // OpenRouter's own name for an upstream that failed partway through, beside
  // the content filter (API overview, checked 2026-10-14).
  failedFinish: (reason) =>
    reason === "error"
      ? new ModelClientError(
          "unexplainedError",
          "The model failed partway through the answer without saying why.",
        )
      : undefined,
};

/**
 * The account behind a key. Chosen for this because it is the endpoint that
 * actually refuses a bad key: the catalogue answers one normally, verified
 * against the live provider.
 */
const keyUrl = "https://openrouter.ai/api/v1/key";

async function checkKey(
  apiKey: string,
  fetcher: CatalogFetch,
): Promise<KeyCheck> {
  const response = await fetcher(keyUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) return { accepted: true };
  /*
   * The account endpoint refuses nothing but the key, so any refusal here is
   * about the key - including a 403 that on a model request would be a
   * moderation block.
   */
  return {
    accepted: false,
    error:
      response.status === 401 || response.status === 403
        ? new ModelClientError(
            "unauthorized",
            "OpenRouter rejected the API key.",
          )
        : classifyFailure({ status: response.status }),
  };
}

export const openRouter: Provider = {
  id: "openrouter",
  name: "OpenRouter",
  keyName: "an OpenRouter API key",
  keyVariable: "ZHIYIN_OPENROUTER_API_KEY",
  upstreams: true,
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  pages: { keys: OPENROUTER_KEYS_URL, billing: OPENROUTER_CREDITS_URL },
  send: (input) => sendChatCompletions(dialect, input),
  catalogue: {
    models: fetchOpenRouterCatalog,
    providers: fetchOpenRouterModelProviders,
  },
  describe: (model, options) =>
    fetchOpenRouterModelInfo(model, options.fetcher),
  window: requestWindow,
  reasoning: reasoningCapabilities,
  acceptsImages,
  checkKey,
};
