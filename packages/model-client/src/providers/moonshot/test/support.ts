/** Moonshot's side of the wire, as its Kimi API documentation describes it. */

import type { ModelFetch } from "../../../model-client.js";
import {
  chunksThenDone,
  labClient,
  recording as recordingOf,
  refusal,
  type LabClientOptions,
  type Sent,
} from "../../../../test/lab-wire.js";
import { moonshot } from "../provider.js";

export { drain } from "../../../../test/lab-wire.js";
export type { Sent } from "../../../../test/lab-wire.js";

/** A refusal in the status line, with Moonshot's error type and sentence. */
export function refusing(
  status: number,
  error?: { readonly type: string; readonly message: string },
  headers: Record<string, string> = {},
): ModelFetch {
  return refusal(status, error ? { error } : undefined, headers);
}

/**
 * An answer with the usage Moonshot documents for a stream that asked for it:
 * a short count inside the finishing choice, then a last chunk with no
 * choices whose top-level usage holds the whole count, cache included.
 */
export function answering(
  usage: {
    readonly prompt: number;
    readonly cached: number;
    readonly written: number;
    readonly completion: number;
  },
  model = "kimi-k3",
): ModelFetch {
  const counted = {
    prompt_tokens: usage.prompt,
    completion_tokens: usage.completion,
    total_tokens: usage.prompt + usage.completion,
  };
  return chunksThenDone([
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
    },
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: { reasoning_content: "Thinking." } }],
    },
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: { content: "Done." } }],
    },
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop", usage: counted }],
    },
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [],
      usage: {
        ...counted,
        cached_tokens: usage.cached,
        prompt_tokens_details: {
          cached_tokens: usage.cached,
          cache_write_tokens: usage.written,
        },
      },
    },
  ]);
}

const answered = answering({
  prompt: 1_000_000,
  cached: 400_000,
  written: 100_000,
  completion: 100_000,
});

/** Records each request, then answers it as `answer` does. */
export function recording(sent: Sent[], answer: ModelFetch = answered) {
  return recordingOf(sent, answer);
}

export function moonshotClient(
  options: LabClientOptions & {
    readonly region?: "international" | "mainland";
  } = {},
) {
  return labClient(moonshot, "sk-test", {
    ...options,
    model: options.model ?? "kimi-k3",
    region: options.region ?? "international",
  });
}
