/** Z.ai's side of the wire, as its documentation describes it. */

import type {
  ModelEvent,
  ModelFetch,
  ModelRequest,
} from "../../../model-client.js";
import { ProviderModelClient } from "../../../client.js";
import type { CatalogFetch } from "../../../provider.js";
import { zai } from "../provider.js";

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

/**
 * A refusal in the status line, with Z.ai's business code and sentence. The
 * code arrives as a string in Z.ai's examples and as a number in its schema.
 */
export function refusing(
  status: number,
  error?: { readonly code: string | number; readonly message: string },
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
 * An answer ending as Z.ai's streaming guide shows: the last chunk carries
 * both the finish reason and the usage.
 */
export function endingWith(finishReason: string, text = "Done.") {
  return streamOf([
    {
      id: "answer-1",
      model: "glm-5.3",
      choices: [{ index: 0, delta: { reasoning_content: "Thinking." } }],
    },
    {
      id: "answer-1",
      model: "glm-5.3",
      choices: [{ index: 0, delta: { content: text } }],
    },
    {
      id: "answer-1",
      model: "glm-5.3",
      choices: [
        {
          index: 0,
          finish_reason: finishReason,
          delta: { role: "assistant", content: "" },
        },
      ],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        total_tokens: 1_100_000,
        prompt_tokens_details: { cached_tokens: 400_000 },
      },
    },
  ]);
}

/** Records each request, then answers it as `answer` does. */
export function recording(
  sent: Sent[],
  answer: ModelFetch = endingWith("stop"),
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

export function zaiClient(
  options: {
    readonly region?: "international" | "mainland";
    readonly model?: string;
    readonly fetcher?: ModelFetch;
    readonly catalogFetch?: CatalogFetch;
  } = {},
) {
  const region = options.region ?? "international";
  return new ProviderModelClient(zai, {
    apiKey: async () => "zai-test-key",
    model: options.model ?? "glm-5.3",
    region,
    modelInfo: (model) => zai.describe(model, { region }),
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

/** The events that arrived before the request failed, and the failure. */
export async function untilFailure(
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
