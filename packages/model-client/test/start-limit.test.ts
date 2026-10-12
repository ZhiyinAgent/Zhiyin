import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import type { ModelEvent, ModelFetch } from "../src/model-client.js";
import { anthropic } from "../src/providers/anthropic/provider.js";
import { answer, streamOf } from "../src/providers/anthropic/test/support.js";
import { openAi } from "../src/providers/openai/provider.js";

/**
 * How long a request waits for its answer to start.
 *
 * A connection that never answers is silent from its first byte, and looks
 * the same as a model that has not begun. The wait for the first byte, the
 * response's headers included, has a limit of its own: the silence allowed
 * between bytes unless the provider was measured to start sooner. Anthropic
 * was, on 2026-10-12: its answers began within seconds, so one that has not
 * begun after ninety is abandoned and sent again.
 */

const encoder = new TextEncoder();
const hello = { messages: [{ role: "user" as const, content: "Hello" }] };
const never = () => new Promise<never>(() => undefined);

function client(
  provider: typeof anthropic,
  fetcher: ModelFetch,
  limits: {
    readonly startTimeoutMs?: number;
    readonly stallTimeoutMs?: number;
  },
) {
  return new ProviderModelClient(provider, {
    apiKey: async () => "sk-test",
    model: provider === anthropic ? "claude-haiku-5-5" : "gpt-6-luna",
    modelInfo: (model) => provider.describe(model, {}),
    fetcher,
    retry: { wait: async () => {}, random: () => 0 },
    ...limits,
  });
}

async function drain(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const all: ModelEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

/** A fetch that counts its requests and answers none of them. */
function unanswered() {
  const fetcher = Object.assign(
    (() => {
      fetcher.requests += 1;
      return never();
    }) as ModelFetch,
    { requests: 0 },
  );
  return fetcher;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a request whose answer does not start", () => {
  it("is given up and sent again when no response comes at all", async () => {
    const fetcher = unanswered();

    await expect(
      drain(client(anthropic, fetcher, { startTimeoutMs: 30 }).send(hello)),
    ).rejects.toMatchObject({ code: "networkFailure" });
    // Every attempt the retry policy allows was made, each given up in turn.
    expect(fetcher.requests).toBe(5);
  });

  it("is given up when the response opens and its stream never sends a byte", async () => {
    let requests = 0;
    const fetcher: ModelFetch = async () => {
      requests += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        // Open, and never a byte.
        body: { [Symbol.asyncIterator]: () => ({ next: () => never() }) },
      };
    };

    await expect(
      drain(
        client(anthropic, fetcher, {
          startTimeoutMs: 30,
          stallTimeoutMs: 60_000,
        }).send(hello),
      ),
    ).rejects.toMatchObject({ code: "networkFailure" });
    expect(requests).toBe(5);
  });

  it("leaves an answer that has started to the silence allowed between bytes", async () => {
    const events = answer();
    const fetcher: ModelFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: (async function* () {
        for (const [index, event] of events.entries()) {
          // Started at once, then quiet for longer than the start allows.
          if (index === 1)
            await new Promise((resolve) => setTimeout(resolve, 90));
          yield encoder.encode(
            `event: ${String(event["type"])}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        }
      })(),
    });

    const received = await drain(
      client(anthropic, fetcher, {
        startTimeoutMs: 30,
        stallTimeoutMs: 60_000,
      }).send(hello),
    );

    expect(received.at(-1)?.kind).toBe("done");
  });

  it("is reported as cancelled, not as a failed connection, when its caller cancels the wait", async () => {
    const cancel = new AbortController();
    const fetcher: ModelFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });
    const sent = drain(
      client(anthropic, fetcher, { startTimeoutMs: 60_000 }).send({
        ...hello,
        signal: cancel.signal,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    cancel.abort();

    await expect(sent).rejects.toBe(cancel.signal.reason);
  });
});

describe("how long each provider is waited on to start", () => {
  it("gives Anthropic ninety seconds, as measured, and not the five minutes of a silent stream", async () => {
    vi.useFakeTimers();
    const fetcher = unanswered();
    const sent = drain(client(anthropic, fetcher, {}).send(hello));
    sent.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(89_000);
    expect(fetcher.requests).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetcher.requests).toBe(2);
  });

  it("gives a provider that was not measured the whole silence a stream may keep", async () => {
    vi.useFakeTimers();
    const fetcher = unanswered();
    const sent = drain(client(openAi, fetcher, {}).send(hello));
    sent.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(299_000);
    expect(fetcher.requests).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetcher.requests).toBe(2);
  });

  it("answers at once when the response is there", async () => {
    const received = await drain(
      client(anthropic, streamOf(answer()), {}).send(hello),
    );

    expect(received.at(-1)?.kind).toBe("done");
  });
});
