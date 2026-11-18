/**
 * Anthropic: the Claude models over Anthropic Messages, from one endpoint, in
 * US dollars (Anthropic's API documentation, checked 2026-10-09). Thinking is
 * adaptive and asked for with its summary shown. Where a model lets it be
 * turned off, its entry on the list says how: `disabled`, or `between_tools`,
 * which leaves no thinking before the answer. Each turn's thinking goes back
 * signed, as it arrived, while nothing before it has changed. Anthropic
 * caches only what a request marks. On a model whose entry says it takes tool
 * changes (by the mid-conversation system messages guide, checked
 * 2026-11-01), a tool a request cannot call is withdrawn by a
 * mid-conversation system message, so the tools stay as cached, and a
 * toolkit the conversation opened is defined in one, by value (checked
 * 2026-11-06; measured on Haiku 5.5 that day to keep the cache and be called).
 */

import type { ModelChoiceValue } from "../../choice.js";
import { ModelClientError } from "../../failures.js";
import type { ModelRequest } from "../../model-client.js";
import { keyCheckAt } from "../../key-check.js";
import { listedAt, type ListedModel } from "../../model-list.js";
import type { ListedProvider } from "../../provider.js";
import {
  sendAnthropicMessages,
  type AnthropicMessagesDialect,
} from "../../wires/anthropic-messages/send.js";
import { classifyFailure } from "./failures.js";

const host = "https://api.anthropic.com";
const endpoint = `${host}/v1/messages`;

/**
 * How each "off" a list entry may name is asked for. Both are refused at
 * `xhigh` or `max` effort, which an "off" request never names.
 */
const thinkingOff = { none: "disabled", betweenTools: "between_tools" };

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
 * when asked; without it a thinking block arrives empty. The client has
 * already refused "off" on a model that requires thinking; one that allows it
 * without its entry saying how is refused here, before anything is sent.
 */
function thinking(
  chosen: ModelChoiceValue,
  request: ModelRequest,
  listed: ListedModel | undefined,
) {
  if (request.reasoning?.enabled === false) {
    const off = listed?.reasoningOff;
    if (!off)
      throw new ModelClientError(
        "unsupportedReasoning",
        `Zhiyin's model list does not say how ${listed?.name ?? chosen.model} turns its thinking off. Turn thinking on, or choose another model.`,
      );
    return { thinking: { type: thinkingOff[off] } };
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
  toolChanges: { "anthropic-beta": "inline-tools-2026-09-15" },
  settings: (chosen, request, listed) => {
    // Every request must name its longest reply.
    const longest = request.maximumOutputTokens;
    if (longest === undefined)
      throw new ModelClientError(
        "modelUnavailable",
        `${chosen.model} is not on Zhiyin's list of Claude models. Choose another model on the Model page.`,
      );
    return {
      model: chosen.model,
      max_tokens: longest,
      ...thinking(chosen, request, listed),
    };
  },
  classify: classifyFailure,
};

/**
 * The model listing: a request that proves the key and spends nothing. A key
 * without access is refused there by 403 as well as 401.
 */
const checkKey = keyCheckAt(
  "Anthropic",
  () => `${host}/v1/models?limit=1`,
  signed,
  classifyFailure,
  [401, 403],
);

/** The models the account can use now, by Anthropic's own listing. */
const listedByApi = listedAt(
  "Anthropic",
  // A thousand is the most one page holds; Anthropic lists far fewer.
  () => `${host}/v1/models?limit=1000`,
  signed,
);

export const anthropic: ListedProvider = {
  id: "anthropic",
  name: "Anthropic",
  keyName: "an Anthropic API key",
  keyVariable: "ZHIYIN_ANTHROPIC_API_KEY",
  reasoningSentBack: true,
  /*
   * Measured on 2026-10-12 over seventeen requests, with tools on Haiku 5.5
   * and thinking for a minute on Sonnet 5.5: every answer began with its
   * response, within seconds of being asked for, and none went more than six
   * seconds without a byte. Ninety seconds without a first byte is a
   * connection that never answered. Silence once an answer has begun keeps
   * the longer limit: long thinking on the largest models was not measured.
   */
  startTimeoutMs: 90_000,
  endpoint,
  pages: {
    keys: "https://platform.claude.com/settings/keys",
    billing: "https://platform.claude.com/settings/billing",
  },
  send: (input) => sendAnthropicMessages(dialect, input),
  listed: {
    byApi: listedByApi,
    toolChanges: { withdraw: true, load: true },
  },
  checkKey,
};
