import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { InMemoryMcpCredentials, McpRateRefusedError } from "../src/index.js";
import { managed } from "./declarations.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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
    await folders.make("zhiyin-mcp-pacing-"),
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
      { signal: stop.signal },
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
  /** Fake time for the waits after a refusal, so the gaps are exact. */
  const fakeClock = () =>
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });

  it("sends a call refused with a 429 in its result again after 1, 3 and 5 seconds, and answers with the call that got through", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      refusedInText,
      refusedInText,
      refusedInText,
      found,
    ]);
    fakeClock();

    const [result] = await oneAfterAnother(servers, 1);

    expect(result).toMatchObject({ ok: true });
    expect(sent).toHaveLength(4);
    const [first, second, third] = gaps(sent);
    expect(first).toBeGreaterThanOrEqual(1_000);
    expect(first).toBeLessThan(3_000);
    expect(second).toBeGreaterThanOrEqual(3_000);
    expect(second).toBeLessThan(5_000);
    expect(third).toBeGreaterThanOrEqual(5_000);
    expect(third).toBeLessThan(6_000);
  });

  it("gives up once the third resend is refused too, in the service's own words", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      refusedInText,
      refusedInText,
      refusedInText,
      refusedInText,
      found,
    ]);
    fakeClock();

    const [refused, next] = await oneAfterAnother(servers, 2);

    expect(refused).toMatchObject({ ok: false });
    expect((refused as { reason: string }).reason).toContain(
      "too many requests",
    );
    expect((refused as { reason: string }).reason).toContain(
      "excessive requests",
    );
    // The next call still waits after the last refusal, then goes through.
    expect(next).toMatchObject({ ok: true });
    expect(sent).toHaveLength(5);
    expect(gaps(sent)[3]).toBeGreaterThanOrEqual(5_000);
  });

  it("sends later calls at once after a call gets through, and counts the waits from 1 second again", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      refusedInText,
      found,
      found,
      refusedInText,
      found,
    ]);
    fakeClock();

    const results = await oneAfterAnother(servers, 3);

    expect(results.map((result) => (result as { ok: boolean }).ok)).toEqual([
      true,
      true,
      true,
    ]);
    const [resent, afterSuccess, , resentLater] = gaps(sent);
    expect(resent).toBeGreaterThanOrEqual(1_000);
    expect(afterSuccess).toBe(0);
    expect(resentLater).toBeGreaterThanOrEqual(1_000);
    expect(resentLater).toBeLessThan(3_000);
  });

  it("slows a connector with a declared rate after it refuses", async () => {
    // 600 a minute would allow the next call after 100 ms.
    const { servers, sent } = await recordingServers(600, [
      refusedInText,
      found,
    ]);
    fakeClock();

    const [result] = await oneAfterAnother(servers, 1);

    expect(result).toMatchObject({ ok: true });
    expect(gaps(sent)[0]).toBeGreaterThanOrEqual(1_000);
  });

  it("does not send again a tool error that only speaks of a rate limit, and still slows down after it", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      {
        isError: true,
        content: [{ type: "text", text: "Rate limit exceeded. Slow down." }],
      },
      found,
    ]);
    fakeClock();

    const [refused, next] = await oneAfterAnother(servers, 2);

    expect(refused).toMatchObject({ ok: false });
    expect(next).toMatchObject({ ok: true });
    expect(sent).toHaveLength(2);
    expect(gaps(sent)[0]).toBeGreaterThanOrEqual(1_000);
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

  it("sends a call the transport refused again, after the longer wait the server asked for", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      new McpRateRefusedError(3_000),
      found,
    ]);
    fakeClock();

    const [result] = await oneAfterAnother(servers, 1);

    expect(result).toMatchObject({ ok: true });
    expect(sent).toHaveLength(2);
    expect(gaps(sent)[0]).toBeGreaterThanOrEqual(3_000);
  });

  it("does not send again a call whose server asks for more than a minute", async () => {
    const { servers, sent } = await recordingServers(undefined, [
      new McpRateRefusedError(120_000),
      found,
    ]);
    fakeClock();

    const [refused] = await oneAfterAnother(servers, 1);

    expect(refused).toMatchObject({ ok: false });
    expect(sent).toHaveLength(1);
  });

  it("gives up after three transport refusals of resends, and keeps the connection", async () => {
    const { servers, sent, connections } = await recordingServers(undefined, [
      new McpRateRefusedError(),
      new McpRateRefusedError(),
      new McpRateRefusedError(),
      new McpRateRefusedError(),
      found,
    ]);
    fakeClock();

    const [refused, next] = await oneAfterAnother(servers, 2);

    expect(refused).toMatchObject({ ok: false });
    expect((refused as { reason: string }).reason).toContain(
      "too many requests",
    );
    expect(next).toMatchObject({ ok: true });
    expect(sent).toHaveLength(5);
    expect(connections()).toBe(1);
  });
});
