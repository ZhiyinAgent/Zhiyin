/** Anthropic's side of the wire, as its documentation describes it. */

import type {
  ModelEvent,
  ModelFetch,
  ModelRequest,
} from "../../../model-client.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { anthropic } from "../provider.js";

const encoder = new TextEncoder();

export type Sent = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
};

/** Server-sent events, each named by its type as Anthropic names them. */
export function streamOf(
  events: readonly Record<string, unknown>[],
): ModelFetch {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      for (const event of events)
        yield encoder.encode(
          `event: ${String(event["type"])}\ndata: ${JSON.stringify(event)}\n\n`,
        );
    })(),
  });
}

/** A refusal in the status line, in Anthropic's error shape. */
export function refusing(
  status: number,
  error?: { type: string; message: string; details?: unknown },
  headers: Record<string, string> = {},
): ModelFetch {
  return async () => ({
    ok: false,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: (async function* () {
      if (error)
        yield encoder.encode(
          JSON.stringify({ type: "error", error, request_id: "req_1" }),
        );
    })(),
  });
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
  answered: ModelFetch = streamOf(answer()),
) {
  const fetcher: ModelFetch = async (url, init) => {
    sent.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
    });
    return answered(url, init);
  };
  return fetcher;
}

export function anthropicClient(
  options: {
    readonly model?: string;
    readonly fetcher?: ModelFetch;
    readonly catalogFetch?: CatalogFetch;
  } = {},
) {
  return new ProviderModelClient(anthropic, {
    apiKey: async () => "sk-ant-test",
    model: options.model ?? "claude-opus-5-5",
    modelInfo: (model) => anthropic.describe(model, {}),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.catalogFetch ? { catalogFetch: options.catalogFetch } : {}),
    retry: { wait: async () => {}, random: () => 0 },
  });
}

export async function drain(
  client: ProviderModelClient,
  request: ModelRequest,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of client.send(request)) events.push(event);
  return events;
}
