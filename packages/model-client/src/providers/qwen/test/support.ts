/** Qwen's side of the wire, as QwenCloud's and 千问云's documentation describes it. */

import type { ModelFetch } from "../../../model-client.js";
import {
  chunksThenDone,
  labClient,
  recording as recordingOf,
  refusal,
  type LabClientOptions,
  type Sent,
} from "../../../../test/lab-wire.js";
import { qwen } from "../provider.js";

export { drain } from "../../../../test/lab-wire.js";
export type { Sent } from "../../../../test/lab-wire.js";

/** A refusal in the status line, in the `{error: {...}}` shape Qwen documents. */
export function refusing(
  status: number,
  error?: { readonly message?: string; readonly code?: string },
  headers: Record<string, string> = {},
): ModelFetch {
  return refusal(
    status,
    error
      ? { error: { type: "invalid_request_error", param: null, ...error } }
      : undefined,
    headers,
  );
}

const answered = chunksThenDone([
  {
    id: "chatcmpl-1",
    model: "qwen3.8-max",
    choices: [{ index: 0, delta: { reasoning_content: "Thinking." } }],
  },
  {
    id: "chatcmpl-1",
    model: "qwen3.8-max",
    choices: [{ index: 0, delta: { content: "Done." }, finish_reason: "stop" }],
  },
  {
    id: "chatcmpl-1",
    model: "qwen3.8-max",
    choices: [],
    usage: {
      prompt_tokens: 1_000_000,
      completion_tokens: 100_000,
      total_tokens: 1_100_000,
      prompt_tokens_details: { cached_tokens: 400_000 },
      completion_tokens_details: {
        reasoning_tokens: 30_000,
        text_tokens: 100_000,
      },
    },
  },
]);

/** Records each request, then answers it as `answer` does. */
export function recording(sent: Sent[], answer: ModelFetch = answered) {
  return recordingOf(sent, answer);
}

export function qwenClient(
  options: LabClientOptions & {
    readonly region?: "international" | "mainland";
  } = {},
) {
  return labClient(qwen, "sk-ws-test", {
    ...options,
    model: options.model ?? "qwen3.8-max",
    region: options.region ?? "international",
    at: "2026-10-10T12:00:00Z",
  });
}
