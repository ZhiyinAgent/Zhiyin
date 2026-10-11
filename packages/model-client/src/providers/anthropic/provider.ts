/**
 * Anthropic: the Claude models over Anthropic Messages, from one endpoint, in
 * US dollars (Anthropic's API documentation, checked 2026-10-09). Thinking is
 * adaptive and asked for with its summary shown; Opus 5.5 and Fable 5.1 cannot
 * turn it off. Each turn's thinking goes back signed, as it arrived, while
 * nothing before it has changed. Anthropic caches only what a request marks.
 */

import type { ModelChoiceValue } from "../../choice.js";
import { ModelClientError } from "../../failures.js";
import type { ModelRequest } from "../../model-client.js";
import { fromModelList, type ListedByApi } from "../../model-list.js";
import type { CatalogFetch, KeyCheck, Provider } from "../../provider.js";
import {
  sendAnthropicMessages,
  type AnthropicMessagesDialect,
} from "../../wires/anthropic-messages/send.js";
import { classifyFailure } from "./failures.js";
import { anthropicModels, thinkingOff } from "./models.js";

const host = "https://api.anthropic.com";
const endpoint = `${host}/v1/messages`;

/**
 * The key as a bearer token, which Anthropic's authentication page names;
 * `x-api-key` is its legacy alternative. Every request names the API version.
 */
const signed = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  "anthropic-version": "2023-06-01",
});

/**
 * How the model thinks. Readable thinking is a summary Anthropic returns only
 * when asked; without it a thinking block arrives empty.
 */
function thinking(model: string, request: ModelRequest) {
  if (request.reasoning?.enabled === false) {
    const off = thinkingOff[model];
    if (!off)
      throw new ModelClientError(
        "unsupportedReasoning",
        "This model requires reasoning and cannot turn it off.",
      );
    return { thinking: { type: off } };
  }
  return {
    thinking: { type: "adaptive", display: "summarized" },
    ...(request.reasoning?.effort
      ? { output_config: { effort: request.reasoning.effort } }
      : {}),
  };
}

const dialect: AnthropicMessagesDialect = {
  name: "Anthropic",
  provider: "anthropic",
  thinkingBoundToPrefix: true,
  headers: (apiKey) => ({
    ...signed(apiKey),
    "content-type": "application/json",
  }),
  settings: (chosen: ModelChoiceValue, request: ModelRequest) => {
    // Every request must name its longest reply, and only the list knows a
    // model's.
    const longest =
      request.maximumOutputTokens ??
      anthropicModels.models.find((model) => model.id === chosen.model)
        ?.maximumOutputTokens;
    if (longest === undefined)
      throw new ModelClientError(
        "modelUnavailable",
        `${chosen.model} is not on Zhiyin's list of Claude models. Choose another model on the Model page.`,
      );
    return {
      model: chosen.model,
      max_tokens: longest,
      ...thinking(chosen.model, request),
    };
  },
  classify: classifyFailure,
};

/** The model listing: a request that proves the key and spends nothing. */
async function checkKey(
  apiKey: string,
  fetcher: CatalogFetch,
): Promise<KeyCheck> {
  const response = await fetcher(`${host}/v1/models?limit=1`, {
    headers: signed(apiKey),
  });
  if (response.ok) return { accepted: true };
  return {
    accepted: false,
    error:
      response.status === 401 || response.status === 403
        ? new ModelClientError(
            "unauthorized",
            "Anthropic rejected the API key.",
          )
        : classifyFailure({ status: response.status }),
  };
}

/** The models the account can use now, by Anthropic's own listing. */
const listedByApi: ListedByApi = async (options) => {
  const apiKey = await options.apiKey?.();
  const fetcher: CatalogFetch =
    options.fetcher ??
    ((url, init) =>
      fetch(url, {
        headers: init.headers,
        signal: AbortSignal.timeout(15_000),
      }));
  // A thousand is the most one page holds; Anthropic lists far fewer.
  const response = await fetcher(`${host}/v1/models?limit=1000`, {
    headers: apiKey ? signed(apiKey) : {},
  });
  if (!response.ok)
    throw new Error("Anthropic's model listing is unavailable.");
  const listing = (await response.json()) as { data?: unknown };
  if (!Array.isArray(listing.data))
    throw new Error("Anthropic's model listing is unreadable.");
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

export const anthropic: Provider = {
  id: "anthropic",
  name: "Anthropic",
  keyName: "an Anthropic API key",
  keyVariable: "ZHIYIN_ANTHROPIC_API_KEY",
  reasoningSentBack: true,
  endpoint,
  pages: {
    keys: "https://platform.claude.com/settings/keys",
    billing: "https://platform.claude.com/settings/billing",
  },
  send: (input) => sendAnthropicMessages(dialect, input),
  ...fromModelList(anthropicModels, listedByApi),
  checkKey,
};
