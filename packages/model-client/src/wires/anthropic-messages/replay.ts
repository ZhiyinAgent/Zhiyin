/**
 * What an assistant turn over Anthropic Messages needs back to continue from
 * it: its thinking blocks exactly as they arrived, where they sat among its
 * words and calls, and two fingerprints: of everything sent before the turn,
 * and of the turn's own words and calls as they arrived. The rest of the app
 * keeps the record with the turn and never reads it (ADR 0015).
 *
 * The fingerprints are what let a later request tell whether a block is still
 * valid. Anthropic accepts a replayed thinking block only while the system
 * prompt, the tools and every message before it are unchanged, and asks for
 * the thinking to be left out from an edited turn on.
 */

import { createHash, type Hash } from "node:crypto";
import type { ModelReplay } from "@zhiyin/contract";
import type { ModelToolCall } from "../../model-client.js";

/** The format a record names, so it goes back only over this one. */
const anthropicMessagesFormat = "anthropic-messages";

/** A thinking block as it arrived, to go back unchanged. */
type ThinkingBlock =
  | {
      readonly type: "thinking";
      readonly thinking: string;
      readonly signature: string;
    }
  | { readonly type: "redacted_thinking"; readonly data: string };

/** One block of a turn, in the order the blocks arrived. */
export type RecordedBlock =
  | ThinkingBlock
  /** Words, by their length in the turn's text. */
  | { readonly type: "text"; readonly length: number }
  /** A call, by its id. */
  | { readonly type: "tool_use"; readonly id: string };

export type TurnRecord = {
  /** Everything sent before the turn: system prompt, tools and messages. */
  readonly prefix: string;
  /** The turn's words and calls as they arrived. */
  readonly turn: string;
  readonly blocks: readonly RecordedBlock[];
};

/**
 * A running fingerprint of a request, added to part by part. `at()` is the
 * fingerprint of everything added so far.
 */
export class Fingerprint {
  readonly #hash: Hash = createHash("sha256");

  add(part: unknown): void {
    this.#hash.update(JSON.stringify(part));
  }

  at(): string {
    return this.#hash.copy().digest("base64");
  }
}

/** A turn's words and calls, as the record fingerprints them. */
export function turnFingerprint(
  text: string,
  calls: readonly ModelToolCall[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        text,
        calls.map((call) => [call.id, call.name, call.arguments]),
      ]),
    )
    .digest("base64");
}

const isString = (value: unknown): value is string => typeof value === "string";

function recordedBlock(value: unknown): RecordedBlock | undefined {
  if (!value || typeof value !== "object") return undefined;
  const block = value as Record<string, unknown>;
  switch (block["type"]) {
    case "thinking":
      return isString(block["thinking"]) && isString(block["signature"])
        ? {
            type: "thinking",
            thinking: block["thinking"],
            signature: block["signature"],
          }
        : undefined;
    case "redacted_thinking":
      return isString(block["data"])
        ? { type: "redacted_thinking", data: block["data"] }
        : undefined;
    case "text":
      return typeof block["length"] === "number" &&
        Number.isInteger(block["length"]) &&
        block["length"] >= 0
        ? { type: "text", length: block["length"] }
        : undefined;
    case "tool_use":
      return isString(block["id"])
        ? { type: "tool_use", id: block["id"] }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * The record a turn carries, when this provider wrote it over this format and
 * it can be read. Anything else is no record: the turn goes back with its
 * words and calls only.
 */
export function readRecord(
  replay: ModelReplay | undefined,
  provider: string,
): TurnRecord | undefined {
  if (
    !replay ||
    replay.provider !== provider ||
    replay.format !== anthropicMessagesFormat ||
    !replay.data ||
    typeof replay.data !== "object"
  )
    return undefined;
  const data = replay.data as Record<string, unknown>;
  if (!isString(data["prefix"]) || !isString(data["turn"])) return undefined;
  if (!Array.isArray(data["blocks"])) return undefined;
  const blocks = data["blocks"].map(recordedBlock);
  if (blocks.some((block) => block === undefined)) return undefined;
  return {
    prefix: data["prefix"],
    turn: data["turn"],
    blocks: blocks as RecordedBlock[],
  };
}

export function replayOf(provider: string, record: TurnRecord): ModelReplay {
  return { provider, format: anthropicMessagesFormat, data: record };
}
