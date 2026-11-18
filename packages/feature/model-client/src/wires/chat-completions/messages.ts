/**
 * The conversation and its tools as Chat Completions carries them, including
 * what a request asks the provider to keep in its cache.
 */

import type {
  ModelMessage,
  ModelTool,
  ModelUsage,
} from "../../model-client.js";

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

/** Where a provider's messages differ from the common form. */
export type ChatMessageOptions = {
  /** The assistant message field the turn's reasoning goes back in. */
  readonly reasoning?: "reasoning_content";
  /**
   * Every assistant turn carries that field, empty where the turn kept no
   * reasoning: the provider refuses a turn without it.
   */
  readonly reasoningOnEveryTurn?: true;
  /**
   * False where the provider's tool message has no `name`: a tool result is
   * then tied to its call by the call's id alone.
   */
  readonly toolName?: false;
};

function chatMessage(
  message: ModelMessage,
  marked: boolean,
  options: ChatMessageOptions,
) {
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
      ...(options.reasoning &&
      (message.reasoning || options.reasoningOnEveryTurn)
        ? { [options.reasoning]: message.reasoning ?? "" }
        : {}),
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
      ...(options.toolName === false ? {} : { name: message.name }),
    };
  return { role: message.role, content };
}

/**
 * The messages as sent. `marked` names the messages whose end is marked as a
 * place the cache may end; every other message is left exactly as it is.
 */
export function chatMessages(
  messages: readonly ModelMessage[],
  marked: readonly number[] = [],
  options: ChatMessageOptions = {},
) {
  const ends = new Set(marked);
  return messages.map((message, index) =>
    chatMessage(message, ends.has(index), options),
  );
}

export function chatTools(tools: readonly ModelTool[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
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
    readonly completion_tokens_details?: {
      readonly reasoning_tokens?: unknown;
    };
  };
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** `requestId` stands where the chunk names no request. */
export function usageFrom(
  chunk: UsageChunk,
  requestId: string,
): ModelUsage | undefined {
  if (!chunk.usage) return undefined;
  const details = chunk.usage.prompt_tokens_details;
  const reasoning = chunk.usage.completion_tokens_details?.reasoning_tokens;
  return {
    requestId: typeof chunk.id === "string" ? chunk.id : requestId,
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
    ...(typeof reasoning === "number" && Number.isFinite(reasoning)
      ? { reasoningTokens: reasoning }
      : {}),
  };
}
