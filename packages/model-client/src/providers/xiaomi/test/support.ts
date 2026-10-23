/** Xiaomi MiMo's side of the wire, as its documentation describes it. */

import type { ModelFetch } from "../../../model-client.js";
import {
  chunksThenDone,
  labClient,
  recording as recordingOf,
  refusal,
  type LabClientOptions,
  type Sent,
} from "../../../../test/lab-wire.js";
import { xiaomi } from "../../../../test/shipped-providers.js";

export { drain } from "../../../../test/lab-wire.js";
export type { Sent } from "../../../../test/lab-wire.js";

/** A refusal in the status line, with Xiaomi's sentence where there is one. */
export function refusing(
  status: number,
  message?: string,
  headers: Record<string, string> = {},
): ModelFetch {
  return refusal(status, message ? { error: { message } } : undefined, headers);
}

/**
 * Shaped like the streamed example in Xiaomi's deep-thinking guide: every
 * delta field present and null where unused, a finish chunk whose usage is
 * null, then usage alone in a chunk with no choices.
 */
const answered = chunksThenDone([
  {
    id: "answer-1",
    model: "mimo-v2.6-pro",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: {
          content: null,
          role: null,
          tool_calls: null,
          reasoning_content: "Thinking.",
        },
        finish_reason: null,
      },
    ],
  },
  {
    id: "answer-1",
    model: "mimo-v2.6-pro",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: {
          content: "Done.",
          role: null,
          tool_calls: null,
          reasoning_content: null,
        },
        finish_reason: null,
      },
    ],
  },
  {
    id: "answer-1",
    model: "mimo-v2.6-pro",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: {
          content: null,
          role: null,
          tool_calls: null,
          reasoning_content: null,
        },
        finish_reason: "stop",
      },
    ],
    usage: null,
  },
  {
    id: "answer-1",
    model: "mimo-v2.6-pro",
    object: "chat.completion.chunk",
    choices: [],
    usage: {
      completion_tokens: 100_000,
      prompt_tokens: 1_000_000,
      total_tokens: 1_100_000,
      completion_tokens_details: { reasoning_tokens: 30_000 },
      prompt_tokens_details: { cached_tokens: 400_000 },
    },
  },
]);

/** Records each request, then answers it as `answer` does. */
export function recording(sent: Sent[], answer: ModelFetch = answered) {
  return recordingOf(sent, answer);
}

export function xiaomiClient(
  options: LabClientOptions & {
    readonly region?: "international" | "mainland";
  } = {},
) {
  return labClient(xiaomi, "sk-test", {
    ...options,
    model: options.model ?? "mimo-v2.6-pro",
    region: options.region ?? "international",
    at: options.at ?? "2026-10-10T12:00:00Z",
  });
}
