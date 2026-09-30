import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryMcpCredentials } from "../src/index.js";
import { managed } from "./declarations.js";

/** A connection that notes the moment each call reaches it. */
async function recordingServers(requestsPerMinute?: number) {
  const sent: number[] = [];
  const servers = managed(
    await mkdtemp(join(tmpdir(), "zhiyin-mcp-pacing-")),
    async () => ({
      listTools: async () => [{ name: "search" }],
      callTool: async () => {
        sent.push(performance.now());
        return { content: [{ type: "text", text: "found" }] };
      },
      close: async () => {},
    }),
    new InMemoryMcpCredentials(),
  );
  await servers.declare({
    id: "search",
    name: "Search",
    url: "https://example.com/mcp",
    enabled: true,
    ...(requestsPerMinute ? { requestsPerMinute } : {}),
  });
  return { servers, sent };
}

const gaps = (times: readonly number[]) =>
  times.slice(1).map((at, index) => at - times[index]!);

describe("a connector's declared request rate", () => {
  it("spaces the calls sent to a connector by the rate it declares", async () => {
    // 600 a minute is one every 100 ms.
    const { servers, sent } = await recordingServers(600);

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        servers.execute("mcp__search__search", { query: "x" }),
      ),
    );

    for (const result of results) expect(result).toMatchObject({ ok: true });
    expect(sent).toHaveLength(3);
    for (const gap of gaps(sent)) expect(gap).toBeGreaterThanOrEqual(95);
  });

  it("does not hold back a connector that declares no rate", async () => {
    const { servers, sent } = await recordingServers();

    await Promise.all(
      [1, 2, 3].map(() =>
        servers.execute("mcp__search__search", { query: "x" }),
      ),
    );

    expect(sent).toHaveLength(3);
    for (const gap of gaps(sent)) expect(gap).toBeLessThan(50);
  });

  it("never sends a call that was stopped while it waited its turn", async () => {
    // 60 a minute: the second call would wait a whole second.
    const { servers, sent } = await recordingServers(60);
    const stop = new AbortController();

    const first = servers.execute("mcp__search__search", { query: "x" });
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
