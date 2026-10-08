import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryMcpCredentials, McpRateRefusedError } from "../src/index.js";
import { managed } from "./declarations.js";

const found = { content: [{ type: "text", text: "found" }] };

/**
 * What the hosted Tavily server answers when it refuses for rate: a result not
 * marked as an error, carrying the status in its JSON.
 */
const refusedInText = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        error: "Search failed",
        status: 429,
        detail: {
          error:
            "Your request has been blocked due to excessive requests. Please reduce the rate of requests. Verify you are using production API keys.",
        },
      }),
    },
  ],
  isError: false,
};

/**
 * A connection that notes the moment each call reaches it, and answers with
 * each scripted answer in turn — the last one once the script runs out. An
 * answer that is an error is thrown, as a transport failure would be.
 */
async function recordingServers(
  requestsPerMinute?: number,
  answers: readonly unknown[] = [found],
  callTakes = 0,
) {
  const sent: number[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  let connections = 0;
  const servers = managed(
    await mkdtemp(join(tmpdir(), "zhiyin-mcp-pacing-")),
    async () => {
      connections += 1;
      return {
        listTools: async () => [{ name: "search" }],
        callTool: async () => {
          const answer =
            answers[Math.min(sent.length, answers.length - 1)] ?? found;
          sent.push(performance.now());
          inFlight += 1;
          mostInFlight = Math.max(mostInFlight, inFlight);
          if (callTakes)
            await new Promise((resolve) => setTimeout(resolve, callTakes));
          inFlight -= 1;
          if (answer instanceof Error) throw answer;
          return answer;
        },
        close: async () => {},
      };
    },
    new InMemoryMcpCredentials(),
  );
  await servers.declare({
    id: "search",
    name: "Search",
    url: "https://example.com/mcp",
    enabled: true,
    ...(requestsPerMinute ? { requestsPerMinute } : {}),
  });
  return {
    servers,
    sent,
    mostInFlight: () => mostInFlight,
    connections: () => connections,
  };
}

const gaps = (times: readonly number[]) =>
  times.slice(1).map((at, index) => at - times[index]!);

const search = (servers: {
  execute: (name: string, args: unknown) => unknown;
}) =>
  servers.execute("mcp__search__search", { query: "x" }) as Promise<unknown>;

/**
 * Runs calls one after another on the fake clock. A wait may be set only after
 * real file reads, so the clock jumps to each wait once one is set, and stands
 * still while nothing is waiting; the gaps it records are then exact.
 */
async function oneAfterAnother(
  servers: Parameters<typeof search>[0],
  count: number,
) {
  const results: unknown[] = [];
  for (let call = 0; call < count; call += 1) {
    let settled = false;
    const result = search(servers).finally(() => (settled = true));
    while (!settled)
      if (vi.getTimerCount()) await vi.advanceTimersToNextTimerAsync();
      else await new Promise((resolve) => setImmediate(resolve));
    results.push(await result);
  }
  return results;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a connector's declared request rate", () => {
  it("spaces the calls sent to a connector by the rate it declares", async () => {
    // 600 a minute is one every 100 ms.
    const { servers, sent } = await recordingServers(600);

    const results = await Promise.all([1, 2, 3].map(() => search(servers)));

    for (const result of results) expect(result).toMatchObject({ ok: true });
    expect(sent).toHaveLength(3);
    for (const gap of gaps(sent)) expect(gap).toBeGreaterThanOrEqual(95);
  });

  it("sends one call at a time to a connector that declares no rate", async () => {
    const { servers, sent, mostInFlight } = await recordingServers(
      undefined,
      [found],
      30,
    );

    const results = await Promise.all([1, 2, 3].map(() => search(servers)));

    for (const result of results) expect(result).toMatchObject({ ok: true });
    expect(sent).toHaveLength(3);
    expect(mostInFlight()).toBe(1);
    // Each goes as soon as the one before it is answered, not after a wait.
    for (const gap of gaps(sent)) expect(gap).toBeLessThan(150);
  });

  it("never sends a call that was stopped while it waited its turn", async () => {
    // 60 a minute: the second call would wait a whole second.
    const { servers, sent } = await recordingServers(60);
    const stop = new AbortController();

    const first = search(servers);
    const waiting = servers.execute(
      "mcp__search__search",
      { query: "y" },
      stop.signal,
    );
    await first;
    stop.abort();

    expect(await waiting).toEqual({
      ok: false,
      reason: "The action was stopped.",
    });
    expect(sent).toHaveLength(1);
  });
});

describe("a connector that refuses for rate", () => {
  it("reports a 429 inside a result not marked as an error as a failure, and does not send it again", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      refusedInText,
    ]);

    const result = await search(servers);

    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toContain(
      "too many requests",
    );
    expect((result as { reason: string }).reason).toContain(
      "excessive requests",
    );
    expect(sent).toHaveLength(1);
  });

  it("waits after a refusal, longer after each, and not at all once a call succeeds", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      refusedInText,
      refusedInText,
      found,
      found,
      refusedInText,
      found,
    ]);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });

    const results = await oneAfterAnother(servers, 6);

    expect(results.map((result) => (result as { ok: boolean }).ok)).toEqual([
      false,
      false,
      true,
      true,
      false,
      true,
    ]);
    const [afterFirst, afterSecond, afterSuccess, , afterLater] = gaps(sent);
    expect(afterFirst).toBeGreaterThanOrEqual(2_000);
    expect(afterSecond).toBeGreaterThanOrEqual(4_000);
    expect(afterSuccess).toBe(0);
    // A success starts the count again.
    expect(afterLater).toBeGreaterThanOrEqual(2_000);
    expect(afterLater).toBeLessThan(4_000);
  });

  it("slows a connector with a declared rate after it refuses", async () => {
    // 600 a minute would allow the next call after 100 ms.
    const { servers, sent } = await recordingServers(600, [
      refusedInText,
      found,
    ]);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });

    await oneAfterAnother(servers, 2);

    expect(gaps(sent)[0]).toBeGreaterThanOrEqual(2_000);
  });

  it("slows down after a tool error that names a rate limit", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      {
        isError: true,
        content: [{ type: "text", text: "Rate limit exceeded. Slow down." }],
      },
      found,
    ]);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });

    const [refused] = await oneAfterAnother(servers, 2);

    expect(refused).toMatchObject({ ok: false });
    expect(gaps(sent)[0]).toBeGreaterThanOrEqual(2_000);
  });

  it("does not take a result about rate limits for a refusal", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      {
        content: [
          {
            type: "text",
            text: "Too many requests? A rate limit answers with status 429.",
          },
        ],
      },
    ]);

    const results = await Promise.all([1, 2].map(() => search(servers)));

    for (const result of results) expect(result).toMatchObject({ ok: true });
    expect(gaps(sent)[0]).toBeLessThan(50);
  });

  it("sends a call the transport refused once more, after the wait the server asked for", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      new McpRateRefusedError(3_000),
      found,
    ]);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });

    const [result] = await oneAfterAnother(servers, 1);

    expect(result).toMatchObject({ ok: true });
    expect(sent).toHaveLength(2);
    expect(gaps(sent)[0]).toBeGreaterThanOrEqual(3_000);
  });

  it("gives up after a second transport refusal, and keeps the connection", async () => {
    const { servers, sent, connections } = await recordingServers(undefined, [
      new McpRateRefusedError(),
      new McpRateRefusedError(),
      found,
    ]);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });

    const [refused, next] = await oneAfterAnother(servers, 2);

    expect(refused).toMatchObject({ ok: false });
    expect((refused as { reason: string }).reason).toContain(
      "too many requests",
    );
    expect(next).toMatchObject({ ok: true });
    expect(sent).toHaveLength(3);
    expect(connections()).toBe(1);
  });
});
