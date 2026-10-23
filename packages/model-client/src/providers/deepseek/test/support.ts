/** DeepSeek's side of the wire, as its documentation describes it. */

import type { ModelFetch } from "../../../model-client.js";
import {
  chunksThenDone,
  labClient,
  recording as recordingOf,
  refusal,
  type LabClientOptions,
  type Sent,
} from "../../../../test/lab-wire.js";
import { deepSeek } from "../../../../test/shipped-providers.js";

export { drain } from "../../../../test/lab-wire.js";
export type { Sent } from "../../../../test/lab-wire.js";

/** An answer that begins, then stops for `reason`. */
export function endingWith(reason: string): ModelFetch {
  return chunksThenDone([
    {
      id: "answer-1",
      model: "deepseek-flash",
      choices: [{ index: 0, delta: { content: "Part" } }],
    },
    {
      id: "answer-1",
      model: "deepseek-flash",
      choices: [{ index: 0, delta: {}, finish_reason: reason }],
    },
  ]);
}

/** A refusal in the status line, with DeepSeek's sentence. */
export function refusing(
  status: number,
  message?: string,
  headers: Record<string, string> = {},
): ModelFetch {
  return refusal(
    status,
    message ? { error: { message, type: "invalid_request_error" } } : undefined,
    headers,
  );
}

const answered = chunksThenDone([
  {
    id: "answer-1",
    model: "deepseek-v4-pro",
    choices: [{ index: 0, delta: { reasoning_content: "Thinking." } }],
    usage: null,
  },
  {
    id: "answer-1",
    model: "deepseek-v4-pro",
    choices: [{ index: 0, delta: { content: "Done." }, finish_reason: "stop" }],
    usage: null,
  },
  {
    id: "answer-1",
    model: "deepseek-v4-pro",
    choices: [],
    usage: {
      prompt_tokens: 1_000_000,
      completion_tokens: 100_000,
      total_tokens: 1_100_000,
      prompt_cache_hit_tokens: 400_000,
      prompt_cache_miss_tokens: 600_000,
      prompt_tokens_details: { cached_tokens: 400_000 },
      completion_tokens_details: { reasoning_tokens: 30_000 },
    },
  },
]);

/** Records each request, then answers it as `answer` does. */
export function recording(sent: Sent[], answer: ModelFetch = answered) {
  return recordingOf(sent, answer);
}

export function deepSeekClient(
  options: LabClientOptions & {
    readonly region?: "international" | "mainland";
  } = {},
) {
  return labClient(deepSeek, "sk-test", {
    ...options,
    model: options.model ?? "deepseek-v4-pro",
    region: options.region ?? "international",
    at: options.at ?? "2026-10-10T12:00:00Z",
  });
}
