/** Moonshot's side of the wire, as its Kimi API documentation describes it. */

import type {
  ModelEvent,
  ModelFetch,
  ModelRequest,
} from "../../../model-client.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { moonshot } from "../provider.js";

const encoder = new TextEncoder();

export type Sent = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
};

/** A stream of Chat Completions chunks, then `[DONE]`. */
function streamOf(chunks: readonly unknown[]): ModelFetch {
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

/** A refusal in the status line, with Moonshot's error type and sentence. */
export function refusing(
  status: number,
  error?: { readonly type: string; readonly message: string },
  headers: Record<string, string> = {},
): ModelFetch {
  return async () => ({
    ok: false,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: (async function* () {
      if (error) yield encoder.encode(JSON.stringify({ error }));
    })(),
  });
}

/**
 * An answer with the usage Moonshot documents for a stream that asked for it:
 * a short count inside the finishing choice, then a last chunk with no
 * choices whose top-level usage holds the whole count, cache included.
 */
export function answering(
  usage: {
    readonly prompt: number;
    readonly cached: number;
    readonly written: number;
    readonly completion: number;
  },
  model = "kimi-k3",
): ModelFetch {
  const counted = {
    prompt_tokens: usage.prompt,
    completion_tokens: usage.completion,
    total_tokens: usage.prompt + usage.completion,
  };
  return streamOf([
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
    },
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: { reasoning_content: "Thinking." } }],
    },
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: { content: "Done." } }],
    },
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop", usage: counted }],
    },
    {
      id: "answer-1",
      object: "chat.completion.chunk",
      model,
      choices: [],
      usage: {
        ...counted,
        cached_tokens: usage.cached,
        prompt_tokens_details: {
          cached_tokens: usage.cached,
          cache_write_tokens: usage.written,
        },
      },
    },
  ]);
}

const answered = answering({
  prompt: 1_000_000,
  cached: 400_000,
  written: 100_000,
  completion: 100_000,
});

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

export function moonshotClient(
  options: {
    readonly region?: "international" | "mainland";
    readonly model?: string;
    readonly fetcher?: ModelFetch;
    readonly catalogFetch?: CatalogFetch;
  } = {},
) {
  const region = options.region ?? "international";
  return new ProviderModelClient(moonshot, {
    apiKey: async () => "sk-test",
    model: options.model ?? "kimi-k3",
    region,
    modelInfo: (model) => moonshot.describe(model, { region }),
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
