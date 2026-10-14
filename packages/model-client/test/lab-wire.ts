/**
 * A lab's side of the wire, as every lab's tests stand it up: each request
 * recorded as it was sent, an answer streamed as a lab streams it, a refusal
 * with the body a lab sends. What a stream and a refusal hold is each lab's
 * own, and stays with its tests.
 */

import type {
  ModelEvent,
  ModelFetch,
  ModelRequest,
} from "../src/model-client.js";
import { ProviderModelClient } from "../src/client.js";
import type { CatalogFetch, Provider } from "../src/provider.js";

const encoder = new TextEncoder();

export type Sent = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
};

/** A 200 response whose body is these server-sent events, as written. */
function served(events: readonly string[]): ModelFetch {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      for (const event of events) yield encoder.encode(event);
    })(),
  });
}

/** A stream of Chat Completions chunks, then `[DONE]`. */
export function chunksThenDone(chunks: readonly unknown[]): ModelFetch {
  return served([
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ]);
}

/** Server-sent events, each named on its event line by its type. */
export function namedEvents(
  events: readonly Readonly<Record<string, unknown>>[],
): ModelFetch {
  return served(
    events.map(
      (event) =>
        `event: ${String(event["type"])}\ndata: ${JSON.stringify(event)}\n\n`,
    ),
  );
}

/** A refusal in the status line, with `body` as the lab sends it, if any. */
export function refusal(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
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

/** Records each request, then answers it as `answer` does. */
export function recording(sent: Sent[], answer: ModelFetch): ModelFetch {
  return async (url, init) => {
    sent.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
    });
    return answer(url, init);
  };
}

/** What a lab's tests may set on the client they drive. */
export type LabClientOptions = {
  readonly model?: string;
  readonly region?: string;
  readonly fetcher?: ModelFetch;
  readonly catalogFetch?: CatalogFetch;
  /** The time the client believes it is, where a test depends on it. */
  readonly at?: string;
};

/** A client for one lab, with a test key and retries that do not wait. */
export function labClient(
  provider: Provider,
  apiKey: string,
  options: LabClientOptions & { readonly model: string },
): ProviderModelClient {
  const region = options.region;
  return new ProviderModelClient(provider, {
    apiKey: async () => apiKey,
    model: options.model,
    ...(region ? { region } : {}),
    modelInfo: (model) => provider.describe(model, region ? { region } : {}),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.catalogFetch ? { catalogFetch: options.catalogFetch } : {}),
    ...(options.at ? { now: () => new Date(options.at as string) } : {}),
    retry: { wait: async () => {}, random: () => 0 },
  });
}

/** Every event one request produced. */
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
