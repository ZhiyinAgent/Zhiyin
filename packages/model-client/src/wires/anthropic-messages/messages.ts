/**
 * The conversation and its tools as Anthropic Messages carries them: the
 * system prompt as top-level text blocks, everything after it as user and
 * assistant turns of content blocks, the tool results that answer a turn first
 * in the user turn after it, thinking sent back only while it is still valid,
 * and cache marks on the last block of the messages a request names.
 */

import type {
  ModelMessage,
  ModelTool,
  ModelToolCall,
} from "../../model-client.js";
import {
  Fingerprint,
  readRecord,
  turnFingerprint,
  type TurnRecord,
} from "./replay.js";

type Block = Readonly<Record<string, unknown>>;

const marker = { type: "ephemeral" } as const;
/** Anthropic accepts at most four cache marks in one request. */
const mostMarks = 4;

/** A call id with only the characters Anthropic accepts in one. */
const callId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");

/** A call's arguments as the object Anthropic carries them in. */
function inputOf(args: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(args);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const toolUse = (call: ModelToolCall): Block => ({
  type: "tool_use",
  id: callId(call.id),
  name: call.name,
  input: inputOf(call.arguments),
});

/** Words as a text block. Anthropic refuses an empty one, so none is sent. */
const words = (text: string): Block[] => (text ? [{ type: "text", text }] : []);

function userBlocks(message: Extract<ModelMessage, { role: "user" }>): Block[] {
  if (typeof message.content === "string") return words(message.content);
  return message.content.flatMap((part) =>
    part.kind === "text"
      ? words(part.text)
      : [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: part.mediaType,
              data: part.data,
            },
          },
        ],
  );
}

/** One block of an assistant turn, and whether it is thinking. */
type Part = { readonly block: Block; readonly thinking: boolean };

const visible = (block: Block): Part => ({ block, thinking: false });

/**
 * An assistant turn's blocks. A turn whose words and calls are as they arrived
 * is rebuilt in the order its record kept, thinking included; any other turn
 * is its words, then its calls.
 */
function assistantParts(
  message: Extract<ModelMessage, { role: "assistant" }>,
  record: TurnRecord | undefined,
): Part[] {
  const calls = message.toolCalls ?? [];
  const plain = [...words(message.content), ...calls.map(toolUse)].map(visible);
  if (!record || record.turn !== turnFingerprint(message.content, calls))
    return plain;
  const byId = new Map(calls.map((call) => [call.id, call]));
  const parts: Part[] = [];
  let offset = 0;
  let placed = 0;
  for (const block of record.blocks) {
    if (block.type === "text") {
      const text = message.content.slice(offset, offset + block.length);
      offset += block.length;
      parts.push(...words(text).map(visible));
    } else if (block.type === "tool_use") {
      const call = byId.get(block.id);
      if (!call) return plain;
      placed += 1;
      parts.push(visible(toolUse(call)));
    } else parts.push({ block, thinking: true });
  }
  return offset === message.content.length && placed === calls.length
    ? parts
    : plain;
}

type UserTurn = {
  readonly role: "user";
  /** Tool results go first in the turn, as Anthropic requires. */
  readonly results: Block[];
  readonly rest: Block[];
};

type AssistantTurn = {
  readonly role: "assistant";
  readonly parts: readonly Part[];
  readonly record: TurnRecord | undefined;
};

export type AnthropicConversation = {
  readonly system: readonly Block[];
  readonly messages: readonly {
    readonly role: "user" | "assistant";
    readonly content: readonly Block[];
  }[];
  readonly tools: readonly Block[];
  /**
   * The fingerprint of everything this request sends: what a turn that
   * answers it comes after.
   */
  readonly prefix: string;
};

export type ConversationOptions = {
  /** The provider whose records this request may send back. */
  readonly provider: string;
  /**
   * A replayed thinking block is valid only while everything before it is
   * unchanged, so a turn's thinking goes back only then.
   */
  readonly thinkingBoundToPrefix: boolean;
  readonly cacheAfter?: readonly number[];
};

export function anthropicConversation(
  messages: readonly ModelMessage[],
  tools: readonly ModelTool[],
  options: ConversationOptions,
): AnthropicConversation {
  /** Each message's last block other than thinking, where its mark goes. */
  const ends = new Map<number, Block>();
  const system: Block[] = [];
  const turns: (UserTurn | AssistantTurn)[] = [];
  let leading = true;

  messages.forEach((message, index) => {
    if (message.role === "system" && leading) {
      const blocks = words(message.content);
      system.push(...blocks);
      const last = blocks.at(-1);
      if (last) ends.set(index, last);
      return;
    }
    leading = false;
    if (message.role === "assistant") {
      const record = readRecord(message.replay, options.provider);
      const parts = assistantParts(message, record);
      // A turn with nothing but thinking is never sent, so it is never
      // sent one way on one request and another way on the next.
      const last = parts.filter((part) => !part.thinking).at(-1);
      if (!last) return;
      ends.set(index, last.block);
      turns.push({ role: "assistant", parts, record });
      return;
    }
    const blocks =
      message.role === "tool"
        ? [
            {
              type: "tool_result",
              tool_use_id: callId(message.toolCallId),
              ...(message.content ? { content: message.content } : {}),
            },
          ]
        : message.role === "user"
          ? userBlocks(message)
          : words(message.content);
    const last = blocks.at(-1);
    if (!last) return;
    ends.set(index, last);
    const open = turns.at(-1);
    const turn: UserTurn =
      open?.role === "user" ? open : { role: "user", results: [], rest: [] };
    if (turn !== open) turns.push(turn);
    (message.role === "tool" ? turn.results : turn.rest).push(...blocks);
  });

  const toolBlocks: Block[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  const marked = new Set(
    [...new Set(options.cacheAfter ?? [])]
      .sort((left, right) => left - right)
      .flatMap((index) => {
        const block = ends.get(index);
        return block ? [block] : [];
      })
      .slice(-mostMarks),
  );
  const mark = (block: Block): Block =>
    marked.has(block) ? { ...block, cache_control: marker } : block;

  // The fingerprint follows what Anthropic checks a thinking block against:
  // the system prompt, the tools and every message before it, without cache
  // marks and without earlier thinking.
  const fingerprint = new Fingerprint();
  fingerprint.add({ system, tools: toolBlocks });
  const sent = turns.map((turn) => {
    if (turn.role === "user") {
      const content = [...turn.results, ...turn.rest];
      fingerprint.add({ role: "user", content });
      return { role: "user" as const, content: content.map(mark) };
    }
    const keepsThinking =
      turn.record !== undefined &&
      (!options.thinkingBoundToPrefix ||
        turn.record.prefix === fingerprint.at());
    fingerprint.add({
      role: "assistant",
      content: turn.parts
        .filter((part) => !part.thinking)
        .map((part) => part.block),
    });
    return {
      role: "assistant" as const,
      content: turn.parts
        .filter((part) => keepsThinking || !part.thinking)
        .map((part) => (part.thinking ? part.block : mark(part.block))),
    };
  });

  return {
    system: system.map(mark),
    messages: sent,
    tools: toolBlocks,
    prefix: fingerprint.at(),
  };
}
