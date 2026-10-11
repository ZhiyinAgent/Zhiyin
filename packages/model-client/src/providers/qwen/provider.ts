/**
 * Qwen: the Qwen lab's own platforms, over Chat Completions. QwenCloud serves
 * international accounts in US dollars and 千问云 mainland China accounts in
 * yuan; each has one host, and a key from one is not taken by the other.
 *
 * Thinking is set on every request with `enable_thinking`. Earlier turns go
 * back with their `reasoning_content`, which Qwen reads only with
 * `preserve_thinking` on, and asks for with tool results (API reference and
 * thinking guide of both platforms, checked 2026-10-09).
 */

import type { ModelChoiceValue } from "../../choice.js";
import type { ProviderError } from "../../failures.js";
import type { ModelRequest } from "../../model-client.js";
import { fromModelList } from "../../model-list.js";
import type {
  CatalogFetch,
  KeyCheck,
  Provider,
  ProviderRegion,
} from "../../provider.js";
import {
  chatMessages,
  chatTools,
} from "../../wires/chat-completions/messages.js";
import {
  sendChatCompletions,
  type ChatCompletionsDialect,
} from "../../wires/chat-completions/send.js";
import { classifyFailure } from "./failures.js";
import { qwenModels } from "./models.js";

const regions: readonly ProviderRegion[] = [
  {
    id: "international",
    name: "International",
    endpoint:
      "https://maas.qwencloudapi.com/compatible-mode/v1/chat/completions",
    pages: {
      keys: "https://home.qwencloud.com/api-keys",
      billing: "https://home.qwencloud.com/billing/overview",
    },
  },
  {
    id: "mainland",
    name: "Mainland China",
    keyVariable: "ZHIYIN_QWEN_CN_API_KEY",
    endpoint:
      "https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions",
    // 千问云's documentation names no billing page.
    pages: {
      keys: "https://platform.qianwenai.com/home/api-keys",
      billing: "https://platform.qianwenai.com/home/",
    },
  },
];

const headers = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

/** Sent every time: a model's own default is not documented for each one. */
function thinkingFields(request: ModelRequest) {
  const reasoning = request.reasoning;
  return {
    enable_thinking: reasoning?.enabled ?? true,
    ...(reasoning?.enabled && reasoning.effort
      ? { reasoning_effort: reasoning.effort }
      : {}),
    // Without it, Qwen leaves earlier turns' reasoning out of the model's view.
    preserve_thinking: true,
  };
}

const dialect: ChatCompletionsDialect = {
  name: "Qwen",
  headers,
  body: (chosen: ModelChoiceValue, request: ModelRequest) => ({
    model: chosen.model,
    stream: true,
    // Usage arrives only when asked for, on the last chunk.
    stream_options: { include_usage: true },
    // `max_tokens` would limit the words alone, and Qwen is retiring it.
    ...(request.maximumOutputTokens !== undefined
      ? { max_completion_tokens: request.maximumOutputTokens }
      : {}),
    ...thinkingFields(request),
    messages: chatMessages(request.messages, [], {
      reasoning: "reasoning_content",
    }),
    ...(request.tools?.length ? { tools: chatTools(request.tools) } : {}),
  }),
  classify: classifyFailure,
};

/**
 * Neither platform documents a balance or model listing for an API key. One
 * token from the cheapest model, with thinking off, is the cheapest request
 * that proves one.
 */
const keyCheckModel = "qwen3.8-flash";

async function errorIn(response: {
  json(): Promise<unknown>;
}): Promise<ProviderError | undefined> {
  const body = await response.json().catch(() => undefined);
  return body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object"
    ? (body.error as ProviderError)
    : undefined;
}

async function checkKey(
  apiKey: string,
  fetcher: CatalogFetch,
  region?: string,
): Promise<KeyCheck> {
  const platform = regions.find((each) => each.id === region);
  if (!platform) throw new Error(`Qwen has no platform named "${region}".`);
  const response = await fetcher(platform.endpoint, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: keyCheckModel,
      messages: [{ role: "user", content: "Hi" }],
      max_completion_tokens: 1,
      enable_thinking: false,
    }),
  });
  if (response.ok) return { accepted: true };
  if (response.status === 401) {
    const error = await errorIn(response);
    return {
      accepted: false,
      error: classifyFailure({ status: 401, ...(error ? { error } : {}) }),
    };
  }
  // Anything else says nothing about the key: the check could not be made.
  throw new Error(`Qwen answered the key check with HTTP ${response.status}.`);
}

export const qwen: Provider = {
  id: "qwen",
  name: "Qwen",
  keyName: "a Qwen API key",
  // The variable both platforms' own examples read the key from.
  keyVariable: "ZHIYIN_QWEN_API_KEY",
  reasoningSentBack: true,
  regions,
  send: (input) => sendChatCompletions(dialect, input),
  ...fromModelList(qwenModels),
  checkKey,
};
