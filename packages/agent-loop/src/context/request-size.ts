/**
 * How large a request is, in tokens. The provider counts every request it
 * answers; that count is kept, and only what was added after it is estimated,
 * so the estimate's error applies to a short tail rather than to the whole
 * conversation.
 *
 * A count stands only for the exact request it was given for: the same model,
 * the same fixed start and tools, and the same messages byte for byte. So it
 * is kept with a fingerprint of those, and a request that does not start with
 * exactly them — after a model switch, a condensing, a rewind, a cleared result
 * or a picture let go — is estimated whole instead. Nothing needs to announce
 * those changes for the count to be set aside.
 */

import { createHash } from "node:crypto";
import type { ModelMessage, ModelTool, ModelUsage } from "@zhiyin/model-client";
import { estimatedRequestTokens } from "./conversation-context.js";

type Anchor = {
  readonly start: string;
  readonly count: number;
  readonly digest: string;
  readonly tokens: number;
};

export type RequestParts = {
  readonly model: string;
  readonly fixed: readonly ModelMessage[];
  readonly history: readonly ModelMessage[];
  readonly tools: readonly ModelTool[];
};

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function startOf(parts: RequestParts): string {
  return fingerprint([parts.model, parts.fixed, parts.tools]);
}

/**
 * What the provider counted. Some upstreams leave what they read from their
 * cache out of `prompt_tokens`; a cached count larger than the whole shows
 * that, and is added back.
 */
function countedTokens(usage: ModelUsage): number {
  const cached = usage.cacheReadTokens ?? 0;
  return cached > usage.inputTokens
    ? usage.inputTokens + cached
    : usage.inputTokens;
}

export class RequestSize {
  readonly #anchors = new Map<string, Anchor>();

  /** The request's size, and whether a provider's count stands under it. */
  of(
    conversation: string,
    parts: RequestParts,
  ): { readonly tokens: number; readonly measured: boolean } {
    const anchor = this.#anchors.get(conversation);
    if (
      anchor &&
      anchor.count <= parts.history.length &&
      anchor.start === startOf(parts) &&
      anchor.digest === fingerprint(parts.history.slice(0, anchor.count))
    )
      return {
        tokens:
          anchor.tokens +
          (anchor.count < parts.history.length
            ? estimatedRequestTokens(parts.history.slice(anchor.count), [])
            : 0),
        measured: true,
      };
    return {
      tokens: estimatedRequestTokens(
        [...parts.fixed, ...parts.history],
        parts.tools,
      ),
      measured: false,
    };
  }

  /**
   * The provider's count for the request just sent. A request it did not
   * count leaves the last count standing, with more of the tail estimated: a
   * missing count never makes a request look smaller.
   */
  counted(conversation: string, parts: RequestParts, usage: ModelUsage): void {
    this.#anchors.set(conversation, {
      start: startOf(parts),
      count: parts.history.length,
      digest: fingerprint(parts.history),
      tokens: countedTokens(usage),
    });
  }

  forget(conversation: string): void {
    this.#anchors.delete(conversation);
  }
}
