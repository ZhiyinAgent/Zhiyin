/** Mistral's side of the wire, as its documentation describes it. */

import type { ModelFetch } from "../../../model-client.js";
import {
  chunksThenDone,
  labClient,
  recording as recordingOf,
  refusal,
  type LabClientOptions,
  type Sent,
} from "../../../../test/lab-wire.js";
import { mistral } from "../provider.js";

export {
  chunksThenDone as streamOf,
  drain,
  untilFailure as drainUntilFailure,
} from "../../../../test/lab-wire.js";
export type { Sent } from "../../../../test/lab-wire.js";

/** One streamed chunk of a response, as Mistral's examples show it. */
export function chunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  usage: Record<string, unknown> | null = null,
) {
  return {
    id: "answer-1",
    object: "chat.completion.chunk",
    created: 1_764_258_570,
    model: "mistral-large-4",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    usage,
  };
}

/** A refusal in the status line, with the body Mistral sends. */
export function refusing(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): ModelFetch {
  return refusal(status, body, headers);
}

/** Mistral's error body: the explanation at the top level, not wrapped. */
export function mistralError(
  message: string,
  type = "invalid_request_error",
  extra: Record<string, unknown> = {},
) {
  return { object: "error", message, type, param: null, code: null, ...extra };
}

/** An answer that reasons, then says one word, then reports its usage. */
const answered = chunksThenDone([
  chunk({ role: "assistant", content: "" }),
  chunk({
    content: [
      { type: "thinking", thinking: [{ type: "text", text: "Thinking." }] },
    ],
  }),
  chunk({ content: "Done." }, "stop", {
    prompt_tokens: 1_000_000,
    completion_tokens: 100_000,
    total_tokens: 1_100_000,
    prompt_tokens_details: { cached_tokens: 400_000 },
  }),
]);

/** Records each request, then answers it as `answer` does. */
export function recording(sent: Sent[], answer: ModelFetch = answered) {
  return recordingOf(sent, answer);
}

export function mistralClient(options: LabClientOptions = {}) {
  return labClient(mistral, "mistral-test-key", {
    ...options,
    model: options.model ?? "mistral-large-4",
    at: "2026-10-10T12:00:00Z",
  });
}
