/** Qwen's side of the wire, as QwenCloud's and 千问云's documentation describes it. */

import type {
  ModelEvent,
  ModelFetch,
  ModelRequest,
} from "../../../model-client.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { qwen } from "../provider.js";

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

/** A refusal in the status line, in the `{error: {...}}` shape Qwen documents. */
export function refusing(
  status: number,
  error?: { readonly message?: string; readonly code?: string },
  headers: Record<string, string> = {},
): ModelFetch {
  return async () => ({
    ok: false,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: (async function* () {
      if (error)
        yield encoder.encode(
          JSON.stringify({
            error: { type: "invalid_request_error", param: null, ...error },
          }),
        );
    })(),
  });
}

const answered = streamOf([
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

export function qwenClient(
  options: {
    readonly region?: "international" | "mainland";
    readonly model?: string;
    readonly fetcher?: ModelFetch;
    readonly catalogFetch?: CatalogFetch;
  } = {},
) {
  const region = options.region ?? "international";
  return new ProviderModelClient(qwen, {
    apiKey: async () => "sk-ws-test",
    model: options.model ?? "qwen3.8-max",
    region,
    modelInfo: (model) => qwen.describe(model, { region }),
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
