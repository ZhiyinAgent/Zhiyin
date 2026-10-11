/** Mistral's side of the wire, as its documentation describes it. */

import type {
  ModelEvent,
  ModelFetch,
  ModelRequest,
} from "../../../model-client.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { mistral } from "../provider.js";

const encoder = new TextEncoder();

export type Sent = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
};

/** A stream of Chat Completions chunks, then `[DONE]`. */
export function streamOf(chunks: readonly unknown[]): ModelFetch {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      for (const chunk of chunks)
        yield encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
      yield encoder.encode("data: [DONE]\n\n");
    })(),
  });
}

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
  return async () => ({
    ok: false,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: (async function* () {
      if (body !== undefined) yield encoder.encode(JSON.stringify(body));
    })(),
  });
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
const answered = streamOf([
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

export function mistralClient(
  options: {
    readonly model?: string;
    readonly fetcher?: ModelFetch;
    readonly catalogFetch?: CatalogFetch;
  } = {},
) {
  return new ProviderModelClient(mistral, {
    apiKey: async () => "mistral-test-key",
    model: options.model ?? "mistral-large-4",
    modelInfo: (model) => mistral.describe(model, {}),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.catalogFetch ? { catalogFetch: options.catalogFetch } : {}),
    now: () => new Date("2026-10-10T12:00:00Z"),
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

/** What arrived before the request failed, and the failure. */
export async function drainUntilFailure(
  client: ProviderModelClient,
  request: ModelRequest,
): Promise<{ events: ModelEvent[]; error: Record<string, unknown> }> {
  const events: ModelEvent[] = [];
  try {
    for await (const event of client.send(request)) events.push(event);
  } catch (error) {
    return { events, error: error as Record<string, unknown> };
  }
  throw new Error("The request did not fail.");
}
