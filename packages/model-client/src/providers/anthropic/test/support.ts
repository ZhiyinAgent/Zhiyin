/** Anthropic's side of the wire, as its documentation describes it. */

import type { ModelFetch } from "../../../model-client.js";
import {
  labClient,
  namedEvents,
  recording as recordingOf,
  refusal,
  type LabClientOptions,
  type Sent,
} from "../../../../test/lab-wire.js";
import { anthropic } from "../provider.js";

// Anthropic names each server-sent event by its type.
export { drain, namedEvents as streamOf } from "../../../../test/lab-wire.js";
export type { Sent } from "../../../../test/lab-wire.js";

/** A refusal in the status line, in Anthropic's error shape. */
export function refusing(
  status: number,
  error?: { type: string; message: string; details?: unknown },
  headers: Record<string, string> = {},
): ModelFetch {
  return refusal(
    status,
    error ? { type: "error", error, request_id: "req_1" } : undefined,
    headers,
  );
}

/** An answer that thought, said something, and used the cache. */
export function answer(
  usage: Record<string, unknown> = {
    input_tokens: 50_000,
    cache_creation_input_tokens: 100_000,
    cache_read_input_tokens: 850_000,
    output_tokens: 1,
  },
  output = 100_000,
): Record<string, unknown>[] {
  return [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-opus-5-5",
        stop_reason: null,
        stop_sequence: null,
        usage,
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Thinking." },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "sig-1" },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Done." },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: {
        output_tokens: output,
        output_tokens_details: { thinking_tokens: 30_000 },
      },
    },
    { type: "message_stop" },
  ];
}

/** Records each request, then answers it as `answer` does. */
export function recording(
  sent: Sent[],
  answered: ModelFetch = namedEvents(answer()),
) {
  return recordingOf(sent, answered);
}

export function anthropicClient(options: LabClientOptions = {}) {
  return labClient(anthropic, "sk-ant-test", {
    ...options,
    model: options.model ?? "claude-opus-5-5",
  });
}
