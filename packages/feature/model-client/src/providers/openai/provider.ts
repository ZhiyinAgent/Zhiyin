/**
 * OpenAI: one host, over the Responses API, which its current models need for
 * tool calls (model pages and reasoning guide, checked 2026-10-09). OpenAI is
 * asked to store nothing: Zhiyin keeps the conversation and sends it whole,
 * each turn OpenAI wrote going back as its output items, encrypted reasoning
 * included. Caching is automatic; the cache key OpenAI documents only
 * separates one group of requests' cache from another's on these models, so
 * none is sent and conversations share the cached start they have in common.
 * A toolkit the conversation opened joins as a client tool search Zhiyin
 * answers itself, with no search tool declared: measured on GPT-6 Luna on
 * 2026-11-06 to keep the cache and have the loaded tool called.
 */

import type { ModelChoiceValue } from "../../choice.js";
import { keyCheckAt } from "../../key-check.js";
import type { ModelRequest } from "../../model-client.js";
import { listedAt } from "../../model-list.js";
import type { ListedProvider } from "../../provider.js";
import { responsesInput, responsesTools } from "../../wires/responses/input.js";
import {
  sendResponses,
  type ResponsesDialect,
} from "../../wires/responses/send.js";
import { classifyFailure } from "./failures.js";

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
    input: responsesInput(request.messages, id, request.loads),
    ...(request.tools?.length ? { tools: responsesTools(request.tools) } : {}),
    // The tools stay as they were, and with them what is cached.
    ...(request.callable
      ? {
          tool_choice: {
            type: "allowed_tools",
            mode: "auto",
            tools: request.callable.tools.map((name) => ({
              type: "function",
              name,
            })),
          },
        }
      : {}),
  }),
  classify: classifyFailure,
};

function bearer(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/** The model listing: a request that proves the key and spends nothing. */
const checkKey = keyCheckAt(
  "OpenAI",
  () => `${host}/models`,
  bearer,
  classifyFailure,
);

/** The models the account can use now, by OpenAI's own listing. */
const listedByApi = listedAt("OpenAI", () => `${host}/models`, bearer);

export const openAi: ListedProvider = {
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
  // On the models whose entry says so: the callable tools as `allowed_tools`,
  // and a toolkit the model opened as a client tool search, which runs on
  // GPT-5.4 and later (tool search guide, checked 2026-11-06).
  listed: {
    byApi: listedByApi,
    toolChanges: { withdraw: true, load: true },
  },
  checkKey,
};
