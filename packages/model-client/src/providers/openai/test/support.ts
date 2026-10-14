/** OpenAI's side of the wire, as its documentation describes it. */

import type { ModelFetch } from "../../../model-client.js";
import {
  labClient,
  namedEvents,
  recording as recordingOf,
  refusal,
  type LabClientOptions,
  type Sent,
} from "../../../../test/lab-wire.js";
import { openAi } from "../provider.js";

export { drain } from "../../../../test/lab-wire.js";
export type { Sent } from "../../../../test/lab-wire.js";

/** One event as OpenAI streams it. */
export type StreamedEvent = Readonly<Record<string, unknown>> & {
  readonly type: string;
};

/** A stream of Responses events, each typed on its event line. */
export function streamOf(events: readonly StreamedEvent[]): ModelFetch {
  return namedEvents(events);
}

/** A refusal in the status line, in OpenAI's error envelope. */
export function refusing(
  status: number,
  error?: { message: string; type?: string; code?: string | null },
  headers: Record<string, string> = {},
): ModelFetch {
  return refusal(
    status,
    error
      ? {
          error: {
            type: "invalid_request_error",
            param: null,
            code: null,
            ...error,
          },
        }
      : undefined,
    headers,
  );
}

/** The reasoning item a turn produced, as finished. */
export const reasoningItem = {
  id: "rs_1",
  type: "reasoning",
  summary: [{ type: "summary_text", text: "Read the note first." }],
  encrypted_content: "sealed-reasoning",
  status: "completed",
};

export const messageItem = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  status: "completed",
  phase: "final_answer",
  content: [{ type: "output_text", text: "Done.", annotations: [] }],
};

/** Usage on the terminal response, cached input inside the input. */
export function usage(
  input: number,
  cached: number,
  written: number,
  output: number,
) {
  return {
    input_tokens: input,
    input_tokens_details: {
      cached_tokens: cached,
      cache_write_tokens: written,
    },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: 2_000 },
    total_tokens: input + output,
  };
}

export function answeredWith(used = usage(100_000, 60_000, 10_000, 5_000)) {
  return streamOf([
    {
      type: "response.created",
      response: { id: "resp_1", model: "gpt-6.1-sol", status: "in_progress" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...reasoningItem, summary: [], encrypted_content: null },
    },
    {
      type: "response.reasoning_summary_text.delta",
      item_id: "rs_1",
      output_index: 0,
      summary_index: 0,
      delta: "Read the note first.",
    },
    { type: "response.output_item.done", output_index: 0, item: reasoningItem },
    {
      type: "response.output_item.added",
      output_index: 1,
      item: { ...messageItem, status: "in_progress", content: [] },
    },
    {
      type: "response.output_text.delta",
      item_id: "msg_1",
      output_index: 1,
      content_index: 0,
      delta: "Done.",
    },
    { type: "response.output_item.done", output_index: 1, item: messageItem },
    {
      type: "response.completed",
      response: {
        id: "resp_1",
        model: "gpt-6.1-sol",
        status: "completed",
        output: [reasoningItem, messageItem],
        usage: used,
      },
    },
  ]);
}

/** Records each request, then answers it as `answer` does. */
export function recording(sent: Sent[], answer: ModelFetch = answeredWith()) {
  return recordingOf(sent, answer);
}

export function openAiClient(options: LabClientOptions = {}) {
  return labClient(openAi, "sk-test", {
    ...options,
    model: options.model ?? "gpt-6.1-sol",
    at: "2026-10-10T12:00:00Z",
  });
}
