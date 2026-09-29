import { describe, expect, it } from "vitest";
import {
  OpenRouterModelClient,
  type ModelEvent,
  type ModelFetch,
  type ModelFetchResponse,
} from "../src/index.js";

/**
 * ADR 0049: a retryable failure is retried silently while nothing has been
 * passed on to the caller. Once an event has gone out, a repeat would hand the
 * caller a second copy, so it happens only when the caller said it can take
 * back what it received, and is announced so it can.
 */

const apiKey = "test-secret-that-must-not-escape";

function refused(status: number, retryAfter?: string): ModelFetchResponse {
  return {
    ok: false,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null,
    },
    body: null,
  };
}

function answering(text: string): ModelFetchResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      const encoder = new TextEncoder();
      yield encoder.encode(
        `data: ${JSON.stringify({
          id: "gen-1",
          choices: [{ index: 0, delta: { content: text } }],
        })}\n\n`,
      );
      yield encoder.encode(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`,
      );
      yield encoder.encode("data: [DONE]\n\n");
    })(),
  };
}

/** Answers each request with the next response in line, counting requests. */
function inTurn(...responses: (ModelFetchResponse | Error)[]) {
  const fetcher = Object.assign(
    (async () => {
      fetcher.requests += 1;
      const next = responses.shift();
      if (!next) throw new Error("No response left for this request.");
      if (next instanceof Error) throw next;
      return next;
    }) as ModelFetch,
    { requests: 0 },
  );
  return fetcher;
}

/** Records scheduled waits and can simulate a long generation between chunks. */
function pausedClock() {
  const clock = {
    at: 0,
    waits: [] as number[],
    wait: async (ms: number) => {
      clock.waits.push(ms);
      clock.at += ms;
    },
  };
  return clock;
}

function clientWith(fetcher: ModelFetch, clock = pausedClock(), random = 1) {
  return new OpenRouterModelClient({
    apiKey: async () => apiKey,
    fetcher,
    model: "z-ai/glm-5.3-flash",
    retry: { wait: clock.wait, random: () => random },
  });
}

async function collect(stream: AsyncIterable<ModelEvent>) {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const hello = { messages: [{ role: "user" as const, content: "Hi" }] };

describe("a model request that fails before anything was passed on", () => {
  it("is sent again, and the answer arrives once with its retries recorded", async () => {
    const fetcher = inTurn(refused(429), refused(429), answering("Hello"));

    const events = await collect(clientWith(fetcher).send(hello));

    expect(fetcher.requests).toBe(3);
    expect(events.filter((event) => event.kind === "textDelta")).toEqual([
      { kind: "textDelta", text: "Hello" },
    ]);
    const done = events.find((event) => event.kind === "done");
    expect(done?.kind === "done" && done.response?.retries).toEqual([
      { failure: "rateLimited", delayMs: 1_000, kind: "silent" },
      { failure: "rateLimited", delayMs: 2_000, kind: "silent" },
    ]);
  });

  it("says it is waiting, how long, and which attempt comes next", async () => {
    const events = await collect(
      clientWith(inTurn(refused(503), answering("Hello"))).send(hello),
    );

    expect(events[0]).toMatchObject({
      kind: "retrying",
      attempt: 2,
      maximumAttempts: 5,
      delayMs: 1_000,
      reason: "modelUnavailable",
    });
  });

  it("waits as long as the provider asks, up to a minute", async () => {
    const clock = pausedClock();
    await collect(
      clientWith(
        inTurn(refused(429, "8"), refused(429, "600"), answering("Hello")),
        clock,
      ).send(hello),
    );

    expect(clock.waits).toEqual([8_000, 60_000]);
  });

  it("spreads its own waits at random below a doubling ceiling of 30 seconds", async () => {
    const clock = pausedClock();
    await collect(
      clientWith(
        inTurn(
          refused(502),
          refused(502),
          refused(502),
          refused(502),
          answering("Hello"),
        ),
        clock,
        0.5,
      ).send(hello),
    );

    expect(clock.waits).toEqual([500, 1_000, 2_000, 4_000]);
  });

  it("retries a connection that could not be made", async () => {
    const fetcher = inTurn(new TypeError("fetch failed"), answering("Hello"));

    await collect(clientWith(fetcher).send(hello));

    expect(fetcher.requests).toBe(2);
  });

  it("gives up after five attempts and reports the last failure", async () => {
    const fetcher = inTurn(
      refused(429),
      refused(429),
      refused(429),
      refused(429),
      refused(429),
      answering("never reached"),
    );

    await expect(
      collect(clientWith(fetcher).send(hello)),
    ).rejects.toMatchObject({ code: "rateLimited" });
    expect(fetcher.requests).toBe(5);
  });

  it("gives up rather than wait past two minutes in total", async () => {
    const fetcher = inTurn(
      refused(429, "50"),
      refused(429, "50"),
      refused(429, "50"),
      answering("never reached"),
    );

    await expect(
      collect(clientWith(fetcher).send(hello)),
    ).rejects.toMatchObject({ code: "rateLimited" });
    expect(fetcher.requests).toBe(3);
  });

  it("never retries a failure that would fail the same way again", async () => {
    for (const status of [400, 401, 402, 403, 404]) {
      const fetcher = inTurn(refused(status), answering("never reached"));
      await expect(collect(clientWith(fetcher).send(hello))).rejects.toThrow();
      expect(fetcher.requests).toBe(1);
    }
  });

  it("stops waiting at once when the request is cancelled", async () => {
    const controller = new AbortController();
    const client = new OpenRouterModelClient({
      apiKey: async () => apiKey,
      fetcher: inTurn(refused(429, "30"), answering("never reached")),
      model: "z-ai/glm-5.3-flash",
    });
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);

    await expect(
      collect(client.send({ ...hello, signal: controller.signal })),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(120);
  });
});

function partThenRateLimited(): ModelFetchResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      const encoder = new TextEncoder();
      yield encoder.encode(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content: "Partial" } }],
        })}\n\n`,
      );
      yield encoder.encode(
        `data: ${JSON.stringify({
          error: {
            code: 429,
            message: "Rate limit exceeded",
            metadata: { error_type: "rate_limit_exceeded" },
          },
          choices: [
            { index: 0, delta: { content: "" }, finish_reason: "error" },
          ],
        })}\n\n`,
      );
    })(),
  };
}

describe("a model request that fails after something was passed on", () => {
  it("keeps the next attempt within its stated maximum after a restart", async () => {
    const events = await collect(
      clientWith(
        inTurn(partThenRateLimited(), refused(429), answering("Complete")),
      ).send({ ...hello, restartable: true }),
    );
    expect(events.find((event) => event.kind === "retrying")).toMatchObject({
      attempt: 2,
      maximumAttempts: 5,
    });
  });

  it("restarts a long streamed tool call without counting generation time as retry waiting", async () => {
    const clock = pausedClock();
    const fetcher = inTurn(
      {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: (async function* () {
          const encoder = new TextEncoder();
          yield encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "write-large-file",
                        function: {
                          name: "write_file",
                          arguments: '{"path":"large.md","content":"',
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          );
          clock.at += 180_000;
          yield encoder.encode(
            `data: ${JSON.stringify({
              error: {
                code: 504,
                message: "Upstream idle timeout exceeded",
                metadata: { error_type: "timeout" },
              },
            })}\n\n`,
          );
        })(),
      },
      answering("Complete"),
    );

    const events = await collect(
      clientWith(fetcher, clock).send({ ...hello, restartable: true }),
    );

    expect(fetcher.requests).toBe(2);
    expect(clock.waits).toEqual([1_000]);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "restarting",
        restart: 1,
        reason: "networkFailure",
      }),
    );
    expect(events).toContainEqual({ kind: "textDelta", text: "Complete" });
  });

  it("is not sent again, because the caller already has part of it", async () => {
    const fetcher = inTurn(partThenRateLimited(), answering("never reached"));

    await expect(
      collect(clientWith(fetcher).send(hello)),
    ).rejects.toMatchObject({ code: "rateLimited", retryable: true });
    expect(fetcher.requests).toBe(1);
  });

  it("is started again when the caller can take back what it received", async () => {
    const fetcher = inTurn(partThenRateLimited(), answering("Complete"));

    const events = await collect(
      clientWith(fetcher).send({ ...hello, restartable: true }),
    );

    expect(
      events
        .filter(
          (event) => event.kind === "textDelta" || event.kind === "restarting",
        )
        .map((event) => (event.kind === "textDelta" ? event.text : event.kind)),
    ).toEqual(["Partial", "restarting", "Complete"]);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "restarting",
        restart: 1,
        maximumRestarts: 3,
        reason: "rateLimited",
      }),
    );
    const done = events.find((event) => event.kind === "done");
    expect(done?.kind === "done" && done.response?.retries).toEqual([
      { failure: "rateLimited", delayMs: 1_000, kind: "restart" },
    ]);
  });

  it("is started again at most three times", async () => {
    const fetcher = inTurn(
      partThenRateLimited(),
      partThenRateLimited(),
      partThenRateLimited(),
      partThenRateLimited(),
      answering("never reached"),
    );

    await expect(
      collect(clientWith(fetcher).send({ ...hello, restartable: true })),
    ).rejects.toMatchObject({ code: "rateLimited" });
    expect(fetcher.requests).toBe(4);
  });
});
