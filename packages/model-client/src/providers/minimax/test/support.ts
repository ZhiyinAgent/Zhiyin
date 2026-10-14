/** MiniMax's side of the wire, as its documentation describes it. */

import type { ModelFetch } from "../../../model-client.js";
import {
  labClient,
  namedEvents,
  recording as recordingOf,
  refusal,
  type LabClientOptions,
  type Sent,
} from "../../../../test/lab-wire.js";
import { miniMax } from "../provider.js";

export { drain } from "../../../../test/lab-wire.js";
export type { Sent } from "../../../../test/lab-wire.js";

/** A refusal in the status line, in the Anthropic error shape MiniMax uses. */
export function refusing(
  status: number,
  error?: { type: string; message: string },
  headers: Record<string, string> = {},
): ModelFetch {
  return refusal(
    status,
    error ? { type: "error", request_id: "req_1", error } : undefined,
    headers,
  );
}

/**
 * An answer that thought, signed its thinking, said something, and read most
 * of its input from the cache: 150k new, 850k cached, 100k out. Its events are
 * named by their type, in Anthropic's form.
 */
const answered = namedEvents([
  {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [],
      model: "MiniMax-M3",
      stop_reason: null,
      usage: {
        input_tokens: 150_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 850_000,
        output_tokens: 1,
      },
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
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: 100_000 },
  },
  { type: "message_stop" },
]);

/** Records each request, then answers it as `answer` does. */
export function recording(sent: Sent[], answer: ModelFetch = answered) {
  return recordingOf(sent, answer);
}

export function miniMaxClient(
  options: LabClientOptions & {
    readonly region?: "international" | "mainland";
  } = {},
) {
  return labClient(miniMax, "sk-test", {
    ...options,
    model: options.model ?? "MiniMax-M3",
    region: options.region ?? "international",
  });
}
