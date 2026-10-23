/**
 * One answer over Anthropic Messages, read event by event: content blocks that
 * start, change and stop, each by its index; the message's id, model, stop
 * reason and usage; and, at the end, the record of the turn's thinking. An
 * event or block type it does not know is passed over, as Anthropic's
 * versioning policy asks.
 */

import type { ModelEvent, ModelUsage } from "../../model-client.js";
import { unnamedRequest } from "../streamed-request.js";
import {
  turnFingerprint,
  type RecordedBlock,
  type TurnRecord,
} from "./replay.js";

/** One server-sent event, before anything in it is trusted. */
export type StreamEvent = {
  readonly type?: unknown;
  readonly index?: unknown;
  readonly message?: {
    readonly id?: unknown;
    readonly model?: unknown;
    readonly usage?: unknown;
  };
  readonly content_block?: Readonly<Record<string, unknown>>;
  readonly delta?: Readonly<Record<string, unknown>>;
  readonly usage?: unknown;
};

type OpenBlock =
  | { readonly kind: "text"; length: number }
  | { readonly kind: "thinking"; thinking: string; signature: string }
  | { readonly kind: "redacted"; readonly data: string }
  | {
      readonly kind: "call";
      /** Its place among the answer's calls, counting from zero. */
      readonly ordinal: number;
      readonly id: string;
      readonly name: string;
      arguments: string;
      /** The input it began with, for a call that streams none. */
      readonly input: unknown;
    }
  | { readonly kind: "unknown" };

/** What the answer used, each count absent until Anthropic gives it. */
type Counts = {
  readonly input: number | undefined;
  readonly cacheWrite: number | undefined;
  readonly cacheRead: number | undefined;
  readonly output: number | undefined;
  readonly thinking: number | undefined;
};

const noCounts: Counts = {
  input: undefined,
  cacheWrite: undefined,
  cacheRead: undefined,
  output: undefined,
  thinking: undefined,
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export type StopDetails = {
  readonly category?: string;
  readonly explanation?: string;
};

export class AnswerReader {
  readonly #blocks = new Map<number, OpenBlock>();
  /** The blocks in the order they began. */
  readonly #order: OpenBlock[] = [];
  #words = "";
  #calls = 0;
  #counts: Counts | undefined;
  /** Stands for the id when the provider names none. */
  readonly #unnamed = unnamedRequest();
  id: string | undefined;
  model: string | undefined;
  stopReason: string | undefined;
  stopDetails: StopDetails | undefined;
  /** `message_stop` arrived: the provider has nothing more to send. */
  stopped = false;
  /** Words or a call arrived, so the answer can be used. */
  usable = false;

  /** The client's events for one streamed event. */
  read(event: StreamEvent): ModelEvent[] {
    switch (event.type) {
      case "message_start":
        if (typeof event.message?.id === "string") this.id = event.message.id;
        if (typeof event.message?.model === "string")
          this.model = event.message.model;
        this.#count(event.message?.usage);
        return [];
      case "content_block_start":
        return this.#start(event);
      case "content_block_delta":
        return this.#change(event);
      case "content_block_stop":
        return this.#stop(event);
      case "message_delta": {
        const delta = event.delta ?? {};
        if (typeof delta["stop_reason"] === "string")
          this.stopReason = delta["stop_reason"];
        const details = delta["stop_details"];
        if (details && typeof details === "object") {
          const { category, explanation } = details as Record<string, unknown>;
          this.stopDetails = {
            ...(typeof category === "string" ? { category } : {}),
            ...(typeof explanation === "string" ? { explanation } : {}),
          };
        }
        // Counts here are cumulative: they replace those that came before.
        this.#count(event.usage);
        return [];
      }
      case "message_stop":
        this.stopped = true;
        return [];
      default:
        return [];
    }
  }

  #start(event: StreamEvent): ModelEvent[] {
    if (typeof event.index !== "number") return [];
    const started = event.content_block ?? {};
    let block: OpenBlock;
    const events: ModelEvent[] = [];
    switch (started["type"]) {
      case "text": {
        const words = text(started["text"]);
        block = { kind: "text", length: words.length };
        events.push(...this.#said(words));
        break;
      }
      case "thinking": {
        const thinking = text(started["thinking"]);
        block = {
          kind: "thinking",
          thinking,
          signature: text(started["signature"]),
        };
        if (thinking) events.push({ kind: "reasoningDelta", text: thinking });
        break;
      }
      case "redacted_thinking":
        block = { kind: "redacted", data: text(started["data"]) };
        break;
      case "tool_use": {
        block = {
          kind: "call",
          ordinal: this.#calls,
          id: text(started["id"]),
          name: text(started["name"]),
          arguments: "",
          input: started["input"],
        };
        this.#calls += 1;
        this.usable = true;
        events.push({
          kind: "toolCallDelta",
          index: block.ordinal,
          callId: block.id,
          name: block.name,
        });
        break;
      }
      default:
        block = { kind: "unknown" };
    }
    this.#blocks.set(event.index, block);
    this.#order.push(block);
    return events;
  }

  #said(words: string): ModelEvent[] {
    if (!words) return [];
    this.#words += words;
    this.usable = true;
    return [{ kind: "textDelta", text: words }];
  }

  #change(event: StreamEvent): ModelEvent[] {
    const block =
      typeof event.index === "number"
        ? this.#blocks.get(event.index)
        : undefined;
    const delta = event.delta ?? {};
    if (!block) return [];
    if (block.kind === "text" && delta["type"] === "text_delta") {
      const words = text(delta["text"]);
      block.length += words.length;
      return this.#said(words);
    }
    if (block.kind === "thinking" && delta["type"] === "thinking_delta") {
      const thinking = text(delta["thinking"]);
      block.thinking += thinking;
      return thinking ? [{ kind: "reasoningDelta", text: thinking }] : [];
    }
    if (block.kind === "thinking" && delta["type"] === "signature_delta") {
      block.signature += text(delta["signature"]);
      return [];
    }
    if (block.kind === "call" && delta["type"] === "input_json_delta") {
      const part = text(delta["partial_json"]);
      if (!part) return [];
      block.arguments += part;
      return [
        { kind: "toolCallDelta", index: block.ordinal, argumentsDelta: part },
      ];
    }
    return [];
  }

  /** A call that streamed no input has the input it began with. */
  #stop(event: StreamEvent): ModelEvent[] {
    const block =
      typeof event.index === "number"
        ? this.#blocks.get(event.index)
        : undefined;
    if (block?.kind !== "call" || block.arguments) return [];
    const input =
      block.input && typeof block.input === "object" ? block.input : {};
    block.arguments = JSON.stringify(input);
    return [
      {
        kind: "toolCallDelta",
        index: block.ordinal,
        argumentsDelta: block.arguments,
      },
    ];
  }

  #count(usage: unknown): void {
    if (!usage || typeof usage !== "object") return;
    const given = usage as Record<string, unknown>;
    const details = given["output_tokens_details"];
    const previous = this.#counts ?? noCounts;
    this.#counts = {
      input: count(given["input_tokens"]) ?? previous.input,
      cacheWrite:
        count(given["cache_creation_input_tokens"]) ?? previous.cacheWrite,
      cacheRead: count(given["cache_read_input_tokens"]) ?? previous.cacheRead,
      output: count(given["output_tokens"]) ?? previous.output,
      thinking:
        (details && typeof details === "object"
          ? count((details as Record<string, unknown>)["thinking_tokens"])
          : undefined) ?? previous.thinking,
    };
  }

  /**
   * What the answer used. Anthropic's input count leaves out what was read
   * from and written to the cache; the client's includes both.
   */
  usage(): ModelUsage | undefined {
    const counts = this.#counts;
    if (!counts) return undefined;
    const inputTokens =
      (counts.input ?? 0) + (counts.cacheWrite ?? 0) + (counts.cacheRead ?? 0);
    const outputTokens = counts.output ?? 0;
    return {
      requestId: this.id ?? this.#unnamed,
      model: this.model ?? "unknown",
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      ...(counts.cacheRead === undefined
        ? {}
        : { cacheReadTokens: counts.cacheRead }),
      ...(counts.cacheWrite === undefined
        ? {}
        : { cacheWriteTokens: counts.cacheWrite }),
      ...(counts.thinking === undefined
        ? {}
        : { reasoningTokens: counts.thinking }),
    };
  }

  /**
   * The record a later request sends this turn back with, when it had
   * thinking. A thinking block without its signature cannot go back, and
   * Anthropic refuses part of a turn's thinking, so then there is none.
   */
  record(prefix: string): TurnRecord | undefined {
    const blocks = this.#order.flatMap((block): RecordedBlock[] => {
      switch (block.kind) {
        case "text":
          return [{ type: "text", length: block.length }];
        case "thinking":
          return [
            {
              type: "thinking",
              thinking: block.thinking,
              signature: block.signature,
            },
          ];
        case "redacted":
          return [{ type: "redacted_thinking", data: block.data }];
        case "call":
          return [{ type: "tool_use", id: block.id }];
        default:
          return [];
      }
    });
    const thinking = blocks.filter(
      (block) =>
        block.type === "thinking" || block.type === "redacted_thinking",
    );
    if (
      !thinking.length ||
      thinking.some((block) =>
        block.type === "thinking" ? !block.signature : !block.data,
      )
    )
      return undefined;
    const calls = this.#order.flatMap((block) =>
      block.kind === "call"
        ? [{ id: block.id, name: block.name, arguments: block.arguments }]
        : [],
    );
    return { prefix, turn: turnFingerprint(this.#words, calls), blocks };
  }
}
