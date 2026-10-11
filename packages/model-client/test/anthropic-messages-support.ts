/**
 * A lab that speaks Anthropic Messages and exists only in tests: the wire is
 * tested against it, so no wire test depends on a real lab's profile.
 */

import { ModelClientError, type FailureReport } from "../src/failures.js";
import type {
  ModelEvent,
  ModelFetch,
  ModelRequest,
} from "../src/model-client.js";
import {
  sendAnthropicMessages,
  type AnthropicMessagesDialect,
} from "../src/wires/anthropic-messages/send.js";

const encoder = new TextEncoder();

/** What the lab says each error type means. */
const meanings: Record<string, ModelClientError["code"]> = {
  overloaded_error: "modelUnavailable",
  invalid_request_error: "requestRejected",
  rate_limit_error: "rateLimited",
};

export function labDialect(
  reports: FailureReport[] = [],
  profile: Partial<AnthropicMessagesDialect> = {},
): AnthropicMessagesDialect {
  return {
    name: "Test Lab",
    provider: "test-lab",
    thinkingBoundToPrefix: true,
    headers: (apiKey) => ({ "x-test-key": apiKey }),
    settings: (chosen, request) => ({
      model: chosen.model,
      max_tokens: request.maximumOutputTokens ?? 1000,
    }),
    classify: (failure) => {
      reports.push(failure);
      const type = (failure.error as { type?: unknown } | undefined)?.type;
      return new ModelClientError(
        (typeof type === "string" && meanings[type]) || "requestRejected",
        `Test Lab failed (${failure.status}).`,
        { retryable: type === "overloaded_error" },
      );
    },
    ...profile,
  };
}

/** Anthropic's server-sent events, each named by its type. */
export function sse(events: readonly Record<string, unknown>[]): string {
  return events
    .map(
      (event) =>
        `event: ${String(event["type"])}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
}

/** A 200 response streaming `text` as it is. */
export function streaming(text: string): ModelFetch {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      yield encoder.encode(text);
    })(),
  });
}

export function answering(events: readonly Record<string, unknown>[]) {
  return streaming(sse(events));
}

export type Sent = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
};

/** Records each request, then answers it as `answer` does. */
export function recording(
  sent: Sent[],
  answer: ModelFetch = answering(finished("end_turn")),
) {
  const fetcher: ModelFetch = async (url, init) => {
    sent.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
    });
    return answer(url, init);
  };
  return fetcher;
}

type SendOptions = {
  readonly fetcher?: ModelFetch;
  readonly dialect?: AnthropicMessagesDialect;
  readonly stallTimeoutMs?: number;
};

/**
 * One request over the wire: every event it passed on, and the failure that
 * ended it, if one did.
 */
export async function attempt(
  request: ModelRequest,
  options: SendOptions = {},
): Promise<{ readonly events: ModelEvent[]; readonly failure?: unknown }> {
  const events: ModelEvent[] = [];
  try {
    for await (const event of sendAnthropicMessages(
      options.dialect ?? labDialect(),
      {
        endpoint: "https://lab.test/v1/messages",
        apiKey: "lab-key",
        chosen: { model: "lab-model", providers: [] },
        request,
        fetcher: options.fetcher ?? answering(finished("end_turn")),
        stallTimeoutMs: options.stallTimeoutMs ?? 60_000,
      },
    ))
      events.push(event);
  } catch (failure) {
    return { events, failure };
  }
  return { events };
}

/** One request over the wire, with every event it produced. */
export async function sendOnce(
  request: ModelRequest,
  options: SendOptions = {},
): Promise<ModelEvent[]> {
  const { events, failure } = await attempt(request, options);
  if (failure !== undefined) throw failure;
  return events;
}

/** The body of the one request `request` produced. */
export async function sentBody(
  request: ModelRequest,
  dialect?: AnthropicMessagesDialect,
): Promise<Record<string, unknown>> {
  const sent: Sent[] = [];
  await sendOnce(request, {
    fetcher: recording(sent, answering(finished("end_turn"))),
    ...(dialect ? { dialect } : {}),
  });
  return sent[0]?.body ?? {};
}

/** A message that starts, says one word, and stops for `reason`. */
export function finished(
  reason: string,
  usage: Record<string, unknown> = { output_tokens: 3 },
): Record<string, unknown>[] {
  return [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [],
        model: "lab-model",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Done." },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: reason, stop_sequence: null },
      usage,
    },
    { type: "message_stop" },
  ];
}

/** The events of one content block, as Anthropic streams it. */
export const block = {
  text(index: number, text: string) {
    return [
      {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text },
      },
      { type: "content_block_stop", index },
    ];
  },
  thinking(index: number, thinking: string, signature: string) {
    return [
      {
        type: "content_block_start",
        index,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
      {
        type: "content_block_delta",
        index,
        delta: { type: "thinking_delta", thinking },
      },
      {
        type: "content_block_delta",
        index,
        delta: { type: "signature_delta", signature },
      },
      { type: "content_block_stop", index },
    ];
  },
  redacted(index: number, data: string) {
    return [
      {
        type: "content_block_start",
        index,
        content_block: { type: "redacted_thinking", data },
      },
      { type: "content_block_stop", index },
    ];
  },
  toolUse(index: number, id: string, name: string, input: string) {
    return [
      {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id, name, input: {} },
      },
      {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: "" },
      },
      {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: input },
      },
      { type: "content_block_stop", index },
    ];
  },
};

/** A whole message made of `blocks`, stopping for `reason`. */
export function message(
  blocks: readonly Record<string, unknown>[][],
  reason = "end_turn",
): Record<string, unknown>[] {
  const [start, ...rest] = finished(reason);
  return [
    start ?? {},
    ...blocks.flat(),
    ...rest.filter((event) =>
      ["message_delta", "message_stop"].includes(String(event["type"])),
    ),
  ];
}
