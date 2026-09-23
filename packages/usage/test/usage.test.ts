import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileUsageTelemetry } from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-usage-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FileUsageTelemetry", () => {
  it("preserves concurrent usage records across restart", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        usage.record({
          requestId: `request-${index}`,
          model: "test/model",
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          recordedAt: "2026-09-05T08:00:00.000Z",
        }),
      ),
    );
    const state = await new FileUsageTelemetry(root).state(
      new Date("2026-09-05T12:00:00.000Z"),
    );
    expect(state.ranges["7"].requests).toBe(12);
  });
  it("keeps how much of each request the provider read from and wrote to its cache", async () => {
    const root = await temporaryRoot();
    await new FileUsageTelemetry(root).record({
      requestId: "cached",
      model: "anthropic/claude-sonnet-5",
      inputTokens: 1_000,
      outputTokens: 3,
      totalTokens: 1_003,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
      recordedAt: "2026-09-05T08:00:00.000Z",
    });

    expect(
      JSON.parse(await readFile(join(root, "usage.json"), "utf8")),
    ).toMatchObject([
      { requestId: "cached", cacheReadTokens: 900, cacheWriteTokens: 100 },
    ]);
  });

  it("aggregates request, token, cost, model, and daily activity without text", async () => {
    const usage = new FileUsageTelemetry(await temporaryRoot());
    await usage.record({
      requestId: "one",
      model: "z-ai/glm-5.3-flash",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      costUsd: 0.0000125,
      recordedAt: "2026-09-02T08:00:00.000Z",
    });
    await usage.record({
      requestId: "two",
      model: "z-ai/glm-5.3-flash",
      inputTokens: 200,
      outputTokens: 40,
      totalTokens: 240,
      costUsd: 0.000025,
      recordedAt: "2026-09-01T08:00:00.000Z",
    });
    await usage.record({
      requestId: "old",
      model: "another/model",
      inputTokens: 500,
      outputTokens: 100,
      totalTokens: 600,
      recordedAt: "2026-08-01T08:00:00.000Z",
    });

    const state = await usage.state(new Date("2026-09-02T12:00:00.000Z"));

    expect(state).toMatchObject({
      status: "ready",
      costSource: "provider-reported",
      ranges: {
        "7": {
          requests: 2,
          inputTokens: 300,
          outputTokens: 60,
          costUsd: 0.0000375,
          pricedRequests: 2,
          models: [
            {
              model: "z-ai/glm-5.3-flash",
              requests: 2,
              inputTokens: 300,
              outputTokens: 60,
              costUsd: 0.0000375,
            },
          ],
        },
        "30": { requests: 2 },
      },
    });
    if (state.status !== "ready") throw new Error("Expected usage data");
    expect(state.ranges["7"].activity).toHaveLength(7);
    expect(JSON.stringify(state)).not.toContain("prompt");
  });

  it("marks partial cost coverage and survives a restart", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    await usage.record({
      requestId: "unpriced",
      model: "z-ai/glm-5.3-flash",
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      recordedAt: "2026-09-02T08:00:00.000Z",
    });

    const state = await new FileUsageTelemetry(root).state(
      new Date("2026-09-02T12:00:00.000Z"),
    );

    expect(state).toMatchObject({
      status: "ready",
      ranges: { "7": { requests: 1, pricedRequests: 0, costUsd: 0 } },
    });
  });

  it("returns a clear empty state before the first request", async () => {
    const usage = new FileUsageTelemetry(await temporaryRoot());

    await expect(
      usage.state(new Date("2026-09-02T12:00:00.000Z")),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "Usage will appear after the first model request.",
    });
  });
});
