/**
 * Moonshot's Kimi API, over Chat Completions. It runs two platforms with
 * separate accounts and keys: platform.kimi.ai, billed in US dollars, served
 * from api.moonshot.ai, and platform.kimi.com in mainland China, billed in
 * yuan, served from api.moonshot.cn; a key from one is refused by the other.
 * Every earlier turn goes back whole, its `reasoning_content` included: K3
 * and K2.7 Code require it, and K2.6 asks for it within a task (Kimi API
 * documentation, thinking models guide, checked 2026-10-09).
 */

import type { ModelChoiceValue } from "../../choice.js";
import { errorObject } from "../../failures.js";
import type { ModelRequest } from "../../model-client.js";
import { listedAt } from "../../model-list.js";
import type { CatalogFetch, KeyCheck, ListedProvider } from "../../provider.js";
import {
  chatMessages,
  chatTools,
} from "../../wires/chat-completions/messages.js";
import {
  sendChatCompletions,
  type ChatCompletionsDialect,
} from "../../wires/chat-completions/send.js";
import { classifyFailure } from "./failures.js";
import { thinkingSwitched } from "./thinking.js";

/** The platform's API host: the mainland one, or else the international one. */
function hostOf(region: string | undefined): string {
  return region === "mainland"
    ? "https://api.moonshot.cn/v1"
    : "https://api.moonshot.ai/v1";
}

/**
 * K3 takes an effort and is never switched off; K2.6 is switched by
 * `thinking`; K2.7 Code takes nothing. The client has already refused a
 * setting the chosen model does not offer.
 */
function reasoningFields(model: string, request: ModelRequest) {
  const reasoning = request.reasoning;
  if (!reasoning) return {};
  if (thinkingSwitched.has(model))
    return { thinking: { type: reasoning.enabled ? "enabled" : "disabled" } };
  return reasoning.enabled && reasoning.effort
    ? { reasoning_effort: reasoning.effort }
    : {};
}

const dialect: ChatCompletionsDialect = {
  name: "Kimi",
  headers: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  body: (chosen: ModelChoiceValue, request: ModelRequest) => ({
    model: chosen.model,
    stream: true,
    // The whole count, cache reads and writes included, arrives only when
    // asked for, on a last chunk of its own.
    stream_options: { include_usage: true },
    ...(request.maximumOutputTokens !== undefined
      ? { max_completion_tokens: request.maximumOutputTokens }
      : {}),
    // Moonshot asks agents to name the session, so its requests find their
    // cache.
    ...(request.session ? { prompt_cache_key: request.session } : {}),
    ...reasoningFields(chosen.model, request),
    messages: chatMessages(request.messages, [], {
      reasoning: "reasoning_content",
    }),
    ...(request.tools?.length ? { tools: chatTools(request.tools) } : {}),
  }),
  classify: classifyFailure,
};

/** The balance on the key's own platform: proves the key and spends nothing. */
async function checkKey(
  apiKey: string,
  fetcher: CatalogFetch,
  region?: string,
): Promise<KeyCheck> {
  const response = await fetcher(`${hostOf(region)}/users/me/balance`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) return { accepted: true };
  const error = await response.json().then(errorObject, () => undefined);
  // A key Moonshot knows but will not answer for here, such as from outside
  // its organization's allowed addresses, is not a wrong key.
  if (response.status === 403)
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : "Kimi would not show this key's balance.",
    );
  return {
    accepted: false,
    error: classifyFailure({
      status: response.status,
      ...(error ? { error } : {}),
    }),
  };
}

/** The models the account can use now, by its platform's own listing. */
const listedByApi = listedAt(
  "Kimi",
  (region) => `${hostOf(region)}/models`,
  (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
);

export const moonshot: ListedProvider = {
  id: "moonshot",
  name: "Kimi",
  keyName: "a Kimi API key",
  keyVariable: "ZHIYIN_MOONSHOT_API_KEY",
  reasoningSentBack: true,
  regions: [
    {
      id: "international",
      name: "International",
      endpoint: `${hostOf("international")}/chat/completions`,
      pages: {
        keys: "https://platform.kimi.ai/console/api-keys",
        billing: "https://platform.kimi.ai/docs/guide/account-and-payments",
      },
    },
    {
      id: "mainland",
      name: "Mainland China",
      keyVariable: "ZHIYIN_MOONSHOT_CN_API_KEY",
      endpoint: `${hostOf("mainland")}/chat/completions`,
      pages: {
        keys: "https://platform.kimi.com/console/api-keys",
        billing: "https://platform.kimi.com/docs/guide/account-and-payments",
      },
    },
  ],
  send: (input) => sendChatCompletions(dialect, input),
  listed: { byApi: listedByApi },
  checkKey,
};
