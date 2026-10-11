/**
 * Z.ai: the GLM lab, over Chat Completions, on two platforms with their own
 * accounts: Z.ai (api.z.ai, US dollars) for international accounts and
 * BigModel (open.bigmodel.cn, yuan) for mainland China. Z.ai's own SDK
 * reaches the first as `ZaiClient` and the second as `ZhipuAiClient`. Each
 * platform also answers the other's keys (checked live 2026-10-09); which
 * account pays then is not known, so each key goes to its own platform.
 *
 * The GLM-5.3 models always think. Z.ai asks for each earlier turn's
 * `reasoning_content` back, and keeps it in the model's context only with
 * `clear_thinking: false`, which it recommends for agents (API reference,
 * thinking mode guide and model pages of both platforms, checked 2026-10-09).
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
import { classifyFailure, failedFinish } from "./failures.js";
import { zaiModels } from "./models.js";

const regions: readonly ProviderRegion[] = [
  {
    id: "international",
    name: "International",
    endpoint: "https://api.z.ai/api/paas/v4/chat/completions",
    pages: {
      keys: "https://z.ai/manage-apikey/apikey-list",
      billing: "https://z.ai/manage-apikey/billing",
    },
  },
  {
    id: "mainland",
    name: "Mainland China",
    keyVariable: "ZHIYIN_ZAI_CN_API_KEY",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    // BigModel's documentation names no billing page.
    pages: {
      keys: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
      billing: "https://bigmodel.cn/",
    },
  },
];

const headers = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

function thinkingFields(request: ModelRequest) {
  const reasoning = request.reasoning;
  return {
    thinking: {
      type: reasoning?.enabled === false ? "disabled" : "enabled",
      // By default Z.ai drops earlier turns' reasoning from the model's
      // context; this keeps the reasoning sent back.
      clear_thinking: false,
    },
    ...(reasoning?.enabled && reasoning.effort
      ? { reasoning_effort: reasoning.effort }
      : {}),
  };
}

const dialect: ChatCompletionsDialect = {
  name: "Z.ai",
  headers,
  // Usage arrives on the last chunk without being asked for.
  body: (chosen: ModelChoiceValue, request: ModelRequest) => ({
    model: chosen.model,
    stream: true,
    ...(request.maximumOutputTokens !== undefined
      ? { max_tokens: request.maximumOutputTokens }
      : {}),
    ...thinkingFields(request),
    messages: chatMessages(request.messages, [], {
      reasoning: "reasoning_content",
    }),
    // Without `tool_stream`, a call's arguments arrive only once complete.
    ...(request.tools?.length
      ? { tools: chatTools(request.tools), tool_stream: true }
      : {}),
  }),
  classify: classifyFailure,
  failedFinish,
};

/**
 * Neither platform documents an endpoint that lists models, reads the account
 * or checks a key. Both price GLM-4.7-Flash as free, so one token from it is
 * the cheapest documented request that proves a key. The free model is often
 * overloaded (two checks in three answered 429 on 2026-10-09), so a busy
 * answer is followed by one token from GLM-5.3-Flash, the cheapest paid model.
 */
const keyCheckModels = ["glm-4.7-flash", "glm-5.3-flash"] as const;

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
  if (!platform) throw new Error(`Z.ai has no platform named "${region}".`);
  let status = 0;
  for (const model of keyCheckModels) {
    const response = await fetcher(platform.endpoint, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
    });
    if (response.ok) return { accepted: true };
    status = response.status;
    const error = await errorIn(response);
    const failure = classifyFailure({ status, ...(error ? { error } : {}) });
    if (status === 401) return { accepted: false, error: failure };
    // An empty balance is the account's: Z.ai read the key to find it.
    if (failure.code === "outOfCredits") return { accepted: true };
    if (status !== 429) break;
  }
  // Anything else says nothing about the key: the check could not be made.
  throw new Error(`Z.ai answered the key check with HTTP ${status}.`);
}

export const zai: Provider = {
  id: "zai",
  name: "Z.ai",
  keyName: "a Z.ai API key",
  keyVariable: "ZHIYIN_ZAI_API_KEY",
  reasoningSentBack: true,
  regions,
  send: (input) => sendChatCompletions(dialect, input),
  ...fromModelList(zaiModels),
  checkKey,
};
