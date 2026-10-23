/**
 * Xiaomi MiMo: Xiaomi's own API for its MiMo models, over Chat Completions.
 * Pay-as-you-go accounts on either platform use one host; the region the
 * person chooses says whether the account is billed in yuan (mainland China)
 * or US dollars (overseas), and so which price list estimates its costs.
 * Thinking is on unless turned off, and earlier turns go back with their
 * `reasoning_content`, as Xiaomi's deep-thinking guide asks (checked
 * 2026-10-09). A tool conversation sent without it was still accepted when
 * tried live (2026-10-16).
 */

import type { ModelChoiceValue } from "../../choice.js";
import { ModelClientError } from "../../failures.js";
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

const host = "https://api.xiaomimimo.com/v1";
const endpoint = `${host}/chat/completions`;

/** One console serves both platforms' accounts. */
const pages = {
  keys: "https://platform.xiaomimimo.com/#/console/api-keys",
  billing: "https://platform.xiaomimimo.com/#/console/recharge",
};
const modelsUrl = `${host}/models`;

/** Xiaomi takes the key in an `api-key` header, or as a bearer token. */
const keyHeader = (apiKey: string) => ({ "api-key": apiKey });

function reasoningFields(request: ModelRequest) {
  if (!request.reasoning) return {};
  return {
    thinking: { type: request.reasoning.enabled ? "enabled" : "disabled" },
  };
}

const dialect: ChatCompletionsDialect = {
  name: "Xiaomi MiMo",
  headers: (apiKey) => ({
    ...keyHeader(apiKey),
    "Content-Type": "application/json",
  }),
  // Usage arrives on the last chunk unasked, as Xiaomi's streamed example shows.
  body: (chosen: ModelChoiceValue, request: ModelRequest) => ({
    model: chosen.model,
    stream: true,
    ...(request.maximumOutputTokens !== undefined
      ? { max_completion_tokens: request.maximumOutputTokens }
      : {}),
    ...reasoningFields(request),
    messages: chatMessages(request.messages, [], {
      reasoning: "reasoning_content",
      toolName: false,
    }),
    ...(request.tools?.length ? { tools: chatTools(request.tools) } : {}),
  }),
  classify: classifyFailure,
};

/**
 * The model listing proves the key: Xiaomi documents no balance or account
 * endpoint, and bills by tokens, which a listing generates none of.
 */
async function checkKey(
  apiKey: string,
  fetcher: CatalogFetch,
): Promise<KeyCheck> {
  const response = await fetcher(modelsUrl, { headers: keyHeader(apiKey) });
  if (response.ok) return { accepted: true };
  return {
    accepted: false,
    error:
      response.status === 401
        ? new ModelClientError(
            "unauthorized",
            "Xiaomi MiMo rejected the API key.",
          )
        : classifyFailure({ status: response.status }),
  };
}

/** The models the account can use now, by Xiaomi's own listing. */
const listedByApi = listedAt("Xiaomi MiMo", () => modelsUrl, keyHeader);

export const xiaomi: ListedProvider = {
  id: "xiaomi",
  name: "Xiaomi MiMo",
  keyName: "a Xiaomi MiMo API key",
  keyVariable: "ZHIYIN_XIAOMI_API_KEY",
  reasoningSentBack: true,
  regions: [
    { id: "international", name: "International", endpoint, pages },
    {
      id: "mainland",
      name: "Mainland China",
      keyVariable: "ZHIYIN_XIAOMI_CN_API_KEY",
      endpoint,
      pages,
    },
  ],
  send: (input) => sendChatCompletions(dialect, input),
  listed: { byApi: listedByApi },
  checkKey,
};
