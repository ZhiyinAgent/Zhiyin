/**
 * The request and usage as OpenRouter's chat format carries them, including
 * what a request asks the provider to keep in its cache.
 */

import type { ModelMessage, ModelUsage } from "./model-client.js";

/**
 * Models whose provider reuses a cached request start only up to a marked
 * point; every other provider behind OpenRouter finds the shared start itself.
 * From OpenRouter's prompt caching guide, checked 2026-09-23: Anthropic, and
 * these Qwen models served by Alibaba.
 */
const markedQwenModels = new Set([
  "qwen/qwen3-max",
  "qwen/qwen-plus",
  "qwen/qwen3.6-plus",
  "qwen/qwen3-coder-plus",
  "qwen/qwen3-coder-flash",
]);

export function cachesOnlyWhatIsMarked(model: string): boolean {
  const id = model.replace(/^~/, "");
  return id.startsWith("anthropic/") || markedQwenModels.has(id);
}

const marker = { type: "ephemeral" } as const;

function parts(message: ModelMessage) {
  if (typeof message.content === "string")
    return [{ type: "text", text: message.content }];
  return message.content.map((part) =>
    part.kind === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image_url",
          image_url: { url: `data:${part.mediaType};base64,${part.data}` },
        },
  );
}

/** The content with its last part marked as a place the cache may end. */
function markedContent(message: ModelMessage) {
  const all = parts(message);
  return all.map((part, index) =>
    index === all.length - 1 ? { ...part, cache_control: marker } : part,
  );
}

function providerMessage(message: ModelMessage, marked: boolean) {
  const content =
    marked || typeof message.content !== "string"
      ? marked
        ? markedContent(message)
        : parts(message)
      : message.content;
  if (message.role === "assistant")
    return {
      role: message.role,
      content,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  if (message.role === "tool")
    return {
      role: message.role,
      content,
      tool_call_id: message.toolCallId,
      name: message.name,
    };
  return { role: message.role, content };
}

/**
 * The messages as sent. `cacheAfter` names the messages a later request is
 * expected to repeat up to; they are marked only for a model whose provider
 * needs the mark, and left exactly as they are for every other.
 */
export function providerMessages(
  messages: readonly ModelMessage[],
  model: string,
  cacheAfter: readonly number[] = [],
) {
  const marked = new Set(cachesOnlyWhatIsMarked(model) ? cacheAfter : []);
  return messages.map((message, index) =>
    providerMessage(message, marked.has(index)),
  );
}

export type UsageChunk = {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
    readonly cost?: unknown;
    readonly prompt_tokens_details?: {
      readonly cached_tokens?: unknown;
      readonly cache_write_tokens?: unknown;
    };
  };
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function usageFrom(chunk: UsageChunk): ModelUsage | undefined {
  if (!chunk.usage) return undefined;
  const details = chunk.usage.prompt_tokens_details;
  return {
    requestId: typeof chunk.id === "string" ? chunk.id : "unknown",
    model: typeof chunk.model === "string" ? chunk.model : "unknown",
    inputTokens: finiteNumber(chunk.usage.prompt_tokens),
    outputTokens: finiteNumber(chunk.usage.completion_tokens),
    totalTokens: finiteNumber(chunk.usage.total_tokens),
    ...(typeof chunk.usage.cost === "number" &&
    Number.isFinite(chunk.usage.cost)
      ? { costUsd: chunk.usage.cost }
      : {}),
    ...(details
      ? {
          cacheReadTokens: finiteNumber(details.cached_tokens),
          cacheWriteTokens: finiteNumber(details.cache_write_tokens),
        }
      : {}),
  };
}
