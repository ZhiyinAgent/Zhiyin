/**
 * OpenAI: one host, over the Responses API, which its current models need for
 * tool calls (model pages and reasoning guide, checked 2026-10-09). OpenAI is
 * asked to store nothing: Zhiyin keeps the conversation and sends it whole,
 * each turn OpenAI wrote going back as its output items, encrypted reasoning
 * included. Caching is automatic; the cache key OpenAI documents only
 * separates one group of requests' cache from another's on these models, so
 * none is sent and conversations share the cached start they have in common.
 */

import type { ModelChoiceValue } from "../../choice.js";
import { ModelClientError } from "../../failures.js";
import type { ModelRequest } from "../../model-client.js";
import { fromModelList, type ListedByApi } from "../../model-list.js";
import type { CatalogFetch, KeyCheck, Provider } from "../../provider.js";
import { responsesInput, responsesTools } from "../../wires/responses/input.js";
import {
  sendResponses,
  type ResponsesDialect,
} from "../../wires/responses/send.js";
import { classifyFailure } from "./failures.js";
import { openAiModels } from "./models.js";

const id = "openai";
const host = "https://api.openai.com/v1";
const endpoint = `${host}/responses`;

/**
 * The person's effort, `none` where they turned reasoning off, and a readable
 * summary of the reasoning whenever the model reasons.
 */
function reasoningField(request: ModelRequest) {
  if (request.reasoning && !request.reasoning.enabled)
    return { reasoning: { effort: "none" } };
  const effort = request.reasoning?.effort;
  return { reasoning: { ...(effort ? { effort } : {}), summary: "auto" } };
}

const dialect: ResponsesDialect = {
  name: "OpenAI",
  provider: id,
  headers: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  body: (chosen: ModelChoiceValue, request: ModelRequest) => ({
    model: chosen.model,
    stream: true,
    store: false,
    ...(request.maximumOutputTokens !== undefined
      ? { max_output_tokens: request.maximumOutputTokens }
      : {}),
    ...reasoningField(request),
    input: responsesInput(request.messages, id),
    ...(request.tools?.length ? { tools: responsesTools(request.tools) } : {}),
  }),
  classify: classifyFailure,
};

function bearer(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/** The model listing: a request that proves the key and spends nothing. */
async function checkKey(
  apiKey: string,
  fetcher: CatalogFetch,
): Promise<KeyCheck> {
  const response = await fetcher(`${host}/models`, { headers: bearer(apiKey) });
  if (response.ok) return { accepted: true };
  if (response.status === 401)
    return {
      accepted: false,
      error: new ModelClientError(
        "unauthorized",
        "OpenAI rejected the API key.",
      ),
    };
  const body = (await response.json().catch(() => undefined)) as
    { error?: unknown } | undefined;
  return {
    accepted: false,
    error: classifyFailure({
      status: response.status,
      ...(body?.error && typeof body.error === "object"
        ? { error: body.error }
        : {}),
    }),
  };
}

/** The models the account can use now, by OpenAI's own listing. */
const listedByApi: ListedByApi = async (options) => {
  const apiKey = await options.apiKey?.();
  const fetcher: CatalogFetch =
    options.fetcher ??
    ((url, init) =>
      fetch(url, {
        headers: init.headers,
        signal: AbortSignal.timeout(15_000),
      }));
  const response = await fetcher(`${host}/models`, { headers: bearer(apiKey) });
  if (!response.ok) throw new Error("OpenAI's model listing is unavailable.");
  const listing = (await response.json()) as { data?: unknown };
  if (!Array.isArray(listing.data))
    throw new Error("OpenAI's model listing is unreadable.");
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

export const openAi: Provider = {
  id,
  name: "OpenAI",
  keyName: "an OpenAI API key",
  keyVariable: "ZHIYIN_OPENAI_API_KEY",
  endpoint,
  pages: {
    keys: "https://platform.openai.com/settings/organization/api-keys",
    billing: "https://platform.openai.com/settings/organization/billing",
  },
  send: (input) => sendResponses(dialect, input),
  ...fromModelList(openAiModels, listedByApi),
  checkKey,
};
