/**
 * MiniMax: its models over the Anthropic-compatible API, which MiniMax
 * recommends, on two platforms with their own accounts and keys:
 * api.minimax.io in US dollars and api.minimax.cn in yuan (API reference and
 * pricing pages, checked 2026-10-09).
 *
 * Thinking is asked for as `adaptive`; MiniMax-M3 thinks only when asked and
 * M2.x always does. Each turn's thinking comes signed and goes back unchanged,
 * which MiniMax asks for in tool conversations; it documents no refusal of
 * thinking whose earlier conversation changed, so it goes back regardless.
 * MiniMax caches a repeated start by itself, and explicit marks, which bill
 * writes, are left off.
 */

import type { ModelChoiceValue } from "../../choice.js";
import { ModelClientError } from "../../failures.js";
import type { ModelRequest } from "../../model-client.js";
import { fromModelList, type ListedByApi } from "../../model-list.js";
import type {
  CatalogFetch,
  KeyCheck,
  Provider,
  ProviderRegion,
} from "../../provider.js";
import {
  sendAnthropicMessages,
  type AnthropicMessagesDialect,
} from "../../wires/anthropic-messages/send.js";
import { catalogFetch } from "../../keyed-fetch.js";
import { classifyFailure } from "./failures.js";
import { miniMaxModels } from "./models.js";

const hosts: Readonly<Record<string, string>> = {
  international: "https://api.minimax.io",
  mainland: "https://api.minimax.cn",
};

const regions: readonly ProviderRegion[] = [
  {
    id: "international",
    name: "International",
    endpoint: `${hosts["international"]}/anthropic/v1/messages`,
    pages: {
      keys: "https://platform.minimax.io/user-center/basic-information/interface-key",
      billing: "https://platform.minimax.io/user-center/payment/balance",
    },
  },
  {
    id: "mainland",
    name: "Mainland China",
    keyVariable: "ZHIYIN_MINIMAX_CN_API_KEY",
    endpoint: `${hosts["mainland"]}/anthropic/v1/messages`,
    pages: {
      keys: "https://platform.minimax.cn/user-center/basic-information/interface-key",
      billing: "https://platform.minimax.cn/user-center/payment/balance",
    },
  },
];

/** The key as a bearer token, which MiniMax recommends over `x-api-key`. */
const signed = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` });

const dialect: AnthropicMessagesDialect = {
  name: "MiniMax",
  provider: "minimax",
  thinkingBoundToPrefix: false,
  cacheMarks: false,
  headers: (apiKey) => ({
    ...signed(apiKey),
    "content-type": "application/json",
  }),
  settings: (chosen: ModelChoiceValue, request: ModelRequest) => {
    // Every request must name its longest reply, and only the list knows a
    // model's.
    const longest =
      request.maximumOutputTokens ??
      miniMaxModels.models.find((model) => model.id === chosen.model)
        ?.maximumOutputTokens;
    if (longest === undefined)
      throw new ModelClientError(
        "modelUnavailable",
        `${chosen.model} is not on Zhiyin's list of MiniMax models. Choose another model on the Model page.`,
      );
    return {
      model: chosen.model,
      max_tokens: longest,
      thinking: {
        type: request.reasoning?.enabled === false ? "disabled" : "adaptive",
      },
    };
  },
  classify: classifyFailure,
};

function hostOf(region: string | undefined): string {
  const host = region === undefined ? undefined : hosts[region];
  if (!host) throw new Error(`MiniMax has no platform named "${region}".`);
  return host;
}

/** The model listing: a request that proves the key and spends nothing. */
async function checkKey(
  apiKey: string,
  fetcher: CatalogFetch,
  region?: string,
): Promise<KeyCheck> {
  const response = await fetcher(`${hostOf(region)}/anthropic/v1/models`, {
    headers: signed(apiKey),
  });
  if (response.ok) return { accepted: true };
  return {
    accepted: false,
    error:
      response.status === 401
        ? new ModelClientError("unauthorized", "MiniMax rejected the API key.")
        : classifyFailure({ status: response.status }),
  };
}

/** The models the account can use now, by MiniMax's own listing. */
const listedByApi: ListedByApi = async (options) => {
  const apiKey = await options.apiKey?.();
  const fetcher: CatalogFetch = options.fetcher ?? catalogFetch;
  const response = await fetcher(
    `${hostOf(options.region)}/anthropic/v1/models`,
    { headers: apiKey ? signed(apiKey) : {} },
  );
  if (!response.ok) throw new Error("MiniMax's model listing is unavailable.");
  const listing = (await response.json()) as { data?: unknown };
  if (!Array.isArray(listing.data))
    throw new Error("MiniMax's model listing is unreadable.");
  return new Set(
    listing.data.flatMap((model: unknown) =>
      model &&
      typeof model === "object" &&
      "id" in model &&
      typeof model.id === "string"
        ? [model.id]
        : [],
    ),
  );
};

export const miniMax: Provider = {
  id: "minimax",
  name: "MiniMax",
  keyName: "a MiniMax API key",
  // The variable MiniMax's own examples read the key from.
  keyVariable: "ZHIYIN_MINIMAX_API_KEY",
  reasoningSentBack: true,
  regions,
  send: (input) => sendAnthropicMessages(dialect, input),
  ...fromModelList(miniMaxModels, listedByApi),
  checkKey,
};
