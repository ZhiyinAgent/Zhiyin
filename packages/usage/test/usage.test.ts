import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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
  it("writes each request as one line in its month's file, with its conversation, purpose, upstream and tokens", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    await usage.record({
      requestId: "cached",
      model: "anthropic/claude-sonnet-5",
      provider: "Anthropic",
      conversationId: "task-1",
      purpose: "turn",
      inputTokens: 1_000,
      outputTokens: 30,
      totalTokens: 1_030,
      reasoningTokens: 20,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
      costUsd: 0.002,
      recordedAt: "2026-09-05T08:00:00.000Z",
    });
    await usage.record({
      requestId: "next-month",
      model: "anthropic/claude-sonnet-5",
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      recordedAt: "2026-10-01T00:00:00.000Z",
    });

    const lines = (await readFile(join(root, "usage", "2026-09.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        requestId: "cached",
        model: "anthropic/claude-sonnet-5",
        provider: "Anthropic",
        conversationId: "task-1",
        purpose: "turn",
        inputTokens: 1_000,
        outputTokens: 30,
        totalTokens: 1_030,
        reasoningTokens: 20,
        cacheReadTokens: 900,
        cacheWriteTokens: 100,
        costUsd: 0.002,
        recordedAt: "2026-09-05T08:00:00.000Z",
      },
    ]);
    expect(
      await readFile(join(root, "usage", "2026-10.jsonl"), "utf8"),
    ).toContain('"requestId":"next-month"');
  });

  it("skips a damaged line and loads the rest", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    await usage.record(request("before", "2026-09-04T08:00:00.000Z"));
    await appendFile(
      join(root, "usage", "2026-09.jsonl"),
      '{"requestId":"torn","mod\n',
    );
    await usage.record(request("after", "2026-09-05T08:00:00.000Z"));

    const state = await new FileUsageTelemetry(root).state(
      new Date("2026-09-05T12:00:00.000Z"),
    );

    expect(state).toMatchObject({
      status: "ready",
      ranges: { "7": { requests: 2 } },
    });
  });

  it("counts a request recorded twice once, as it was last recorded", async () => {
    const usage = new FileUsageTelemetry(await temporaryRoot());
    await usage.record({
      ...request("same", "2026-09-05T08:00:00.000Z"),
      costUsd: 0.1,
    });
    await usage.record({
      ...request("same", "2026-09-05T08:00:01.000Z"),
      costUsd: 0.3,
    });

    const state = await usage.state(new Date("2026-09-05T12:00:00.000Z"));

    expect(state).toMatchObject({
      status: "ready",
      ranges: { "7": { requests: 1, costUsd: 0.3 } },
    });
  });

  it("removes months older than thirteen when it records, and keeps the rest", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "usage"), { recursive: true });
    for (const month of ["2025-08", "2025-09", "2025-10"])
      await writeFile(join(root, "usage", `${month}.jsonl`), "");

    await new FileUsageTelemetry(root).record(
      request("now", "2026-10-02T08:00:00.000Z"),
    );

    expect((await readdir(join(root, "usage"))).sort()).toEqual([
      "2025-09.jsonl",
      "2025-10.jsonl",
      "2026-10.jsonl",
    ]);
  });

  it("says what each conversation cost in the range, most first, with requests outside one apart", async () => {
    const usage = new FileUsageTelemetry(await temporaryRoot());
    const spend = (
      id: string,
      conversationId: string | undefined,
      costUsd: number | undefined,
      recordedAt = "2026-09-05T08:00:00.000Z",
    ) =>
      usage.record({
        ...request(id, recordedAt),
        ...(conversationId ? { conversationId } : {}),
        ...(costUsd === undefined ? {} : { costUsd }),
      });
    await spend("a1", "cheap", 0.01);
    await spend("b1", "costly", 0.2);
    await spend("b2", "costly", 0.05);
    await spend("b3", "costly", undefined);
    await spend("n1", undefined, 0.02);
    await spend("old", "cheap", 5, "2026-08-01T08:00:00.000Z");

    const state = await usage.state(new Date("2026-09-05T12:00:00.000Z"));

    if (state.status !== "ready") throw new Error("Expected usage data");
    expect(state.ranges["7"].conversations).toEqual([
      {
        conversationId: "costly",
        requests: 3,
        pricedRequests: 2,
        costUsd: 0.25,
      },
      { requests: 1, pricedRequests: 1, costUsd: 0.02 },
      {
        conversationId: "cheap",
        requests: 1,
        pricedRequests: 1,
        costUsd: 0.01,
      },
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

function request(requestId: string, recordedAt: string) {
  return {
    requestId,
    model: "test/model",
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
    recordedAt,
  };
}
