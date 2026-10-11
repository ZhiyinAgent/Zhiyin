/**
 * Mistral (La Plateforme): one host for every account, over Chat
 * Completions. Reasoning is asked for with `reasoning_effort`; while the
 * model thinks, `content` arrives as a list of chunks, its thinking in
 * `thinking` chunks, and Mistral asks for each earlier turn to go back whole,
 * thinking included, in that same form. The request body accepts only the
 * fields Mistral lists, so nothing else is sent (API reference, reasoning
 * guide and prompt caching guide, checked 2026-10-09).
 */

import type { ModelChoiceValue } from "../../choice.js";
import { ModelClientError } from "../../failures.js";
import type { ModelMessage, ModelRequest } from "../../model-client.js";
import { fromModelList, type ListedByApi } from "../../model-list.js";
import type { CatalogFetch, KeyCheck, Provider } from "../../provider.js";
import {
  chatMessages,
  chatTools,
} from "../../wires/chat-completions/messages.js";
import {
  sendChatCompletions,
  type ChatCompletionsDialect,
} from "../../wires/chat-completions/send.js";
import { classifyFailure, failedFinish, refusalFrom } from "./failures.js";
import { mistralModels } from "./models.js";

const host = "https://api.mistral.ai";
const endpoint = `${host}/v1/chat/completions`;

/** `high` returns a full thinking trace and `none` returns none. */
function reasoningFields(request: ModelRequest) {
  if (!request.reasoning) return {};
  return {
    reasoning_effort: request.reasoning.enabled
      ? (request.reasoning.effort ?? "high")
      : "none",
  };
}

/** A turn's reasoning, as the thinking chunk Mistral sent it in. */
function thinkingChunk(reasoning: string) {
  return { type: "thinking", thinking: [{ type: "text", text: reasoning }] };
}

/**
 * The conversation as Mistral wants it back: an assistant turn that kept its
 * reasoning carries it as a thinking chunk ahead of its words.
 */
function mistralMessages(messages: readonly ModelMessage[]) {
  return chatMessages(messages).map((sent, index) => {
    const message = messages[index];
    if (message?.role !== "assistant" || !message.reasoning) return sent;
    return {
      ...sent,
      content: [
        thinkingChunk(message.reasoning),
        ...(message.content ? [{ type: "text", text: message.content }] : []),
      ],
    };
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The text of a list of chunks, or of a thinking chunk's own list. */
function textOf(chunks: unknown): string {
  if (!Array.isArray(chunks)) return "";
  return chunks
    .map((chunk: unknown) => {
      const fields = record(chunk);
      return fields?.["type"] === "text" && typeof fields["text"] === "string"
        ? fields["text"]
        : "";
    })
    .join("");
}

/**
 * A delta's `content`: plain text once the answer has started, or a list of
 * chunks while the model thinks and at the turn from thinking to answering.
 */
function readContent(content: unknown) {
  if (typeof content === "string") return { reasoning: "", text: content };
  if (!Array.isArray(content)) return { reasoning: "", text: "" };
  return {
    reasoning: content
      .map((chunk: unknown) => {
        const fields = record(chunk);
        return fields?.["type"] === "thinking"
          ? textOf(fields["thinking"])
          : "";
      })
      .join(""),
    text: textOf(content),
  };
}

const dialect: ChatCompletionsDialect = {
  name: "Mistral",
  headers: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  body: (chosen: ModelChoiceValue, request: ModelRequest) => ({
    model: chosen.model,
    // Usage arrives on the last chunk without being asked for.
    stream: true,
    ...(request.maximumOutputTokens !== undefined
      ? { max_tokens: request.maximumOutputTokens }
      : {}),
    // Requests that share a start find it in the cache more often when they
    // share a key; Mistral suggests a conversation id.
    ...(request.session ? { prompt_cache_key: request.session } : {}),
    ...reasoningFields(request),
    messages: mistralMessages(request.messages),
    ...(request.tools?.length ? { tools: chatTools(request.tools) } : {}),
  }),
  classify: classifyFailure,
  refusal: refusalFrom,
  content: readContent,
  failedFinish,
};

/** The account's model listing: a request that proves the key and spends nothing. */
async function checkKey(
  apiKey: string,
  fetcher: CatalogFetch,
): Promise<KeyCheck> {
  const response = await fetcher(`${host}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) return { accepted: true };
  return {
    accepted: false,
    error:
      response.status === 401
        ? new ModelClientError("unauthorized", "Mistral rejected the API key.")
        : classifyFailure({ status: response.status }),
  };
}

/**
 * The models the account can use now, by Mistral's own listing, under their
 * ids and their aliases. The reference describes the listing as an object
 * holding `data`, and shows it in its example as a bare list; both are read.
 */
const listedByApi: ListedByApi = async (options) => {
  const apiKey = await options.apiKey?.();
  const fetcher: CatalogFetch =
    options.fetcher ??
    ((url, init) =>
      fetch(url, {
        headers: init.headers,
        signal: AbortSignal.timeout(15_000),
      }));
  const response = await fetcher(`${host}/v1/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!response.ok) throw new Error("Mistral's model listing is unavailable.");
  const listing = await response.json();
  const cards = Array.isArray(listing) ? listing : record(listing)?.["data"];
  if (!Array.isArray(cards))
    throw new Error("Mistral's model listing is unreadable.");
  return new Set(
    cards.flatMap((card: unknown) => {
      const fields = record(card);
      const aliases = Array.isArray(fields?.["aliases"])
        ? fields["aliases"]
        : [];
      return [fields?.["id"], ...aliases].filter(
        (name: unknown): name is string => typeof name === "string",
      );
    }),
  );
};

export const mistral: Provider = {
  id: "mistral",
  name: "Mistral",
  keyName: "a Mistral API key",
  keyVariable: "ZHIYIN_MISTRAL_API_KEY",
  reasoningSentBack: true,
  endpoint,
  pages: {
    keys: "https://console.mistral.ai/api-keys",
    billing: "https://admin.mistral.ai/organization/billing",
  },
  send: (input) => sendChatCompletions(dialect, input),
  ...fromModelList(mistralModels, listedByApi),
  checkKey,
};
