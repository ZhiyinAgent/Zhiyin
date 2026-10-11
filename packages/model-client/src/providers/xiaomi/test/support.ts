/** Xiaomi MiMo's side of the wire, as its documentation describes it. */

import type {
  ModelEvent,
  ModelFetch,
  ModelRequest,
} from "../../../model-client.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { xiaomi } from "../provider.js";

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

/** A refusal in the status line, with Xiaomi's sentence where there is one. */
export function refusing(
  status: number,
  message?: string,
  headers: Record<string, string> = {},
): ModelFetch {
  return async () => ({
    ok: false,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: (async function* () {
      if (message) yield encoder.encode(JSON.stringify({ error: { message } }));
    })(),
  });
}

/**
 * Shaped like the streamed example in Xiaomi's deep-thinking guide: every
 * delta field present and null where unused, a finish chunk whose usage is
 * null, then usage alone in a chunk with no choices.
 */
const answered = streamOf([
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

export function xiaomiClient(
  options: {
    readonly region?: "international" | "mainland";
    readonly model?: string;
    readonly fetcher?: ModelFetch;
    readonly catalogFetch?: CatalogFetch;
    readonly at?: string;
  } = {},
) {
  const region = options.region ?? "international";
  return new ProviderModelClient(xiaomi, {
    apiKey: async () => "sk-test",
    model: options.model ?? "mimo-v2.6-pro",
    region,
    modelInfo: (model) => xiaomi.describe(model, { region }),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.catalogFetch ? { catalogFetch: options.catalogFetch } : {}),
    now: () => new Date(options.at ?? "2026-10-10T12:00:00Z"),
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
