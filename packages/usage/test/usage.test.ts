import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { FileUsageTelemetry } from "../src/index.js";

async function temporaryRoot() {
  return folders.make("zhiyin-usage-test-");
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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
    expect(state).toMatchObject({
      status: "ready",
      ranges: { "7": { requests: 12 } },
    });
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

  it("loses only the line a crash cut off, not the request recorded after it", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    await usage.record(request("before", "2026-09-04T08:00:00.000Z"));
    // Cut off mid-write: no end to the line.
    await appendFile(
      join(root, "usage", "2026-09.jsonl"),
      '{"requestId":"torn","mod',
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

  it("says how many of each model's requests were priced, so one with no price is not shown as free", async () => {
    const usage = new FileUsageTelemetry(await temporaryRoot());
    const spend = (id: string, model: string, costUsd: number | undefined) =>
      usage.record({
        ...request(id, "2026-09-05T08:00:00.000Z"),
        model,
        ...(costUsd === undefined ? {} : { costUsd }),
      });
    await spend("p1", "lab/priced", 0.01);
    await spend("f1", "lab/free", 0);
    await spend("u1", "lab/unpriced", undefined);

    const state = await usage.state(new Date("2026-09-05T12:00:00.000Z"));

    if (state.status !== "ready") throw new Error("Expected usage data");
    const priced = Object.fromEntries(
      state.ranges["7"].models.map((model) => [
        model.model,
        model.pricedRequests,
      ]),
    );
    expect(priced).toEqual({
      "lab/priced": 1,
      "lab/free": 1,
      "lab/unpriced": 0,
    });
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

  it("adds up estimated costs apart from reported ones, each in its own currency, and counts them as priced", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    const at = "2026-09-05T08:00:00.000Z";
    const estimate = (amount: number, currency: string) => ({
      estimatedCost: { amount, currency, priceList: "2026-09-01" },
    });
    await usage.record({
      ...request("reported", at),
      model: "openrouter/model",
      conversationId: "on-openrouter",
      costUsd: 0.2,
    });
    await usage.record({
      ...request("mainland-1", at),
      model: "deepseek-v4-pro",
      conversationId: "on-mainland",
      ...estimate(1.5, "CNY"),
    });
    await usage.record({
      ...request("mainland-2", at),
      model: "deepseek-v4-pro",
      conversationId: "on-mainland",
      ...estimate(0.5, "CNY"),
    });
    await usage.record({
      ...request("international", at),
      model: "gpt-6.1-sol",
      conversationId: "on-openai",
      ...estimate(0.1, "USD"),
    });
    await usage.record({ ...request("unpriced", at), model: "unlisted" });

    const state = await new FileUsageTelemetry(root).state(
      new Date("2026-09-05T12:00:00.000Z"),
    );

    if (state.status !== "ready") throw new Error("Expected usage data");
    const week = state.ranges["7"];
    expect(week).toMatchObject({
      requests: 5,
      pricedRequests: 4,
      costUsd: 0.2,
      estimatedCosts: [
        { currency: "CNY", amount: 2 },
        { currency: "USD", amount: 0.1 },
      ],
    });
    expect(week.activity.at(-1)).toMatchObject({
      costUsd: 0.2,
      estimatedCosts: [
        { currency: "CNY", amount: 2 },
        { currency: "USD", amount: 0.1 },
      ],
    });
    expect(
      week.models.find((model) => model.model === "deepseek-v4-pro"),
    ).toMatchObject({
      costUsd: 0,
      estimatedCosts: [{ currency: "CNY", amount: 2 }],
    });
    // Dollars, reported or estimated, order the costliest first; a cost in
    // another currency is never converted to compare with them.
    expect(week.conversations).toEqual([
      {
        conversationId: "on-openrouter",
        requests: 1,
        pricedRequests: 1,
        costUsd: 0.2,
      },
      {
        conversationId: "on-openai",
        requests: 1,
        pricedRequests: 1,
        costUsd: 0,
        estimatedCosts: [{ currency: "USD", amount: 0.1 }],
      },
      {
        conversationId: "on-mainland",
        requests: 2,
        pricedRequests: 2,
        costUsd: 0,
        estimatedCosts: [{ currency: "CNY", amount: 2 }],
      },
      { requests: 1, pricedRequests: 0, costUsd: 0 },
    ]);
  });

  it("skips a line whose estimated cost is malformed", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    await usage.record({
      ...request("kept", "2026-09-05T08:00:00.000Z"),
    });
    await appendFile(
      join(root, "usage", "2026-09.jsonl"),
      `${JSON.stringify({
        ...request("damaged", "2026-09-05T09:00:00.000Z"),
        estimatedCost: { amount: "lots", currency: "CNY" },
      })}\n`,
      "utf8",
    );

    const state = await new FileUsageTelemetry(root).state(
      new Date("2026-09-05T12:00:00.000Z"),
    );

    expect(state).toMatchObject({ ranges: { "7": { requests: 1 } } });
  });

  it("adds each new request to the history it read, without reading that history again", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    await usage.record(request("first", "2026-09-04T08:00:00.000Z"));
    await usage.record(request("second", "2026-09-04T09:00:00.000Z"));
    await usage.state(new Date("2026-09-05T12:00:00.000Z"));
    // Emptied behind its back: what it already read still counts.
    await writeFile(join(root, "usage", "2026-09.jsonl"), "");

    await usage.record(request("third", "2026-09-05T08:00:00.000Z"));

    await expect(
      usage.state(new Date("2026-09-05T12:00:00.000Z")),
    ).resolves.toMatchObject({ ranges: { "7": { requests: 3 } } });
  });

  it("leaves out a request it could not read back, as it would after a restart", async () => {
    const usage = new FileUsageTelemetry(await temporaryRoot());
    await usage.record(request("readable", "2026-09-04T08:00:00.000Z"));
    await usage.state(new Date("2026-09-05T12:00:00.000Z"));

    await usage.record({
      ...request("unreadable", "2026-09-05T08:00:00.000Z"),
      inputTokens: Number.NaN,
    });

    await expect(
      usage.state(new Date("2026-09-05T12:00:00.000Z")),
    ).resolves.toMatchObject({ ranges: { "7": { requests: 1 } } });
  });

  it("reads a month's history once the range moves into it, and leaves the month it moved past", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    await usage.record(request("september", "2026-09-20T08:00:00.000Z"));
    await usage.state(new Date("2026-09-20T12:00:00.000Z"));
    // Recorded by another instance, so this one has not seen it.
    await new FileUsageTelemetry(root).record(
      request("october", "2026-10-30T08:00:00.000Z"),
    );

    await expect(
      usage.state(new Date("2026-10-31T12:00:00.000Z")),
    ).resolves.toMatchObject({
      ranges: {
        "30": { requests: 1, models: [{ model: "test/model", requests: 1 }] },
      },
    });
  });

  it("saves only a request's accounting, whatever else the record it is handed carries", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);

    await usage.record({
      ...request("with-text", "2026-09-05T08:00:00.000Z"),
      prompt: "Summarise my medical letter",
    } as Parameters<FileUsageTelemetry["record"]>[0]);

    const saved = await readFile(join(root, "usage", "2026-09.jsonl"), "utf8");
    expect(saved).not.toContain("medical letter");
    expect(JSON.parse(saved)).toEqual(
      request("with-text", "2026-09-05T08:00:00.000Z"),
    );
  });

  it("sums requests recorded after a summary as reading the history afresh would", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    const now = new Date("2026-09-20T12:00:00.000Z");
    await usage.record(request("before", "2026-09-18T08:00:00.000Z"));
    await usage.state(now);

    const recorded = [
      {
        ...request("dollars", "2026-09-19T08:00:00.000Z"),
        model: "a/one",
        conversationId: "first",
        costUsd: 0.25,
      },
      {
        ...request("yuan", "2026-09-20T09:00:00.000Z"),
        model: "b/two",
        conversationId: "second",
        estimatedCost: { amount: 1.5, currency: "CNY", priceList: "test" },
      },
      {
        ...request("unpriced", "2026-09-14T09:00:00.000Z"),
        model: "a/one",
        conversationId: "first",
      },
      // Recorded again, on another day: it counts once, on the later day.
      {
        ...request("before", "2026-09-20T10:00:00.000Z"),
        costUsd: 0.5,
      },
    ];
    for (const item of recorded) await usage.record(item);

    const kept = await usage.state(now);
    const afresh = await new FileUsageTelemetry(root).state(now);
    expect(kept).toEqual(afresh);
    expect(kept).toMatchObject({
      ranges: {
        "7": {
          requests: 4,
          costUsd: 0.75,
          activity: expect.arrayContaining([
            expect.objectContaining({ date: "2026-09-18", requests: 0 }),
            expect.objectContaining({ date: "2026-09-20", requests: 2 }),
          ]),
        },
      },
    });
  });

  it("counts a new month's history once the range reaches into it, beside the month it had", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    await usage.record(request("september", "2026-09-25T08:00:00.000Z"));
    await usage.state(new Date("2026-09-30T12:00:00.000Z"));
    // Recorded by another instance, so this one has not seen it.
    await new FileUsageTelemetry(root).record(
      request("october", "2026-10-01T08:00:00.000Z"),
    );

    await expect(
      usage.state(new Date("2026-10-01T12:00:00.000Z")),
    ).resolves.toMatchObject({ ranges: { "30": { requests: 2 } } });
  });

  it("orders models and conversations as a fresh read does once the range leaves a month behind", async () => {
    const root = await temporaryRoot();
    const usage = new FileUsageTelemetry(root);
    const asked = (
      requestId: string,
      model: string,
      conversationId: string,
      recordedAt: string,
    ) => ({ ...request(requestId, recordedAt), model, conversationId });
    await usage.state(new Date("2026-09-20T12:00:00.000Z"));
    await usage.record(
      asked("again", "b", "second", "2026-08-25T08:00:00.000Z"),
    );
    await usage.record(
      asked("other", "a", "first", "2026-09-10T08:00:00.000Z"),
    );
    await usage.record(
      asked("again", "b", "second", "2026-09-10T09:00:00.000Z"),
    );
    await usage.state(new Date("2026-09-20T12:00:00.000Z"));

    // September alone is in range now.
    const now = new Date("2026-09-30T12:00:00.000Z");
    expect(await usage.state(now)).toEqual(
      await new FileUsageTelemetry(root).state(now),
    );
  });

  it("sums a month of heavy use within a few milliseconds of each request", async () => {
    const root = await temporaryRoot();
    const now = new Date("2026-10-20T12:00:00.000Z");
    await mkdir(join(root, "usage"));
    const lines = Array.from({ length: 27_000 }, (_, index) =>
      JSON.stringify({
        ...request(
          `r${index}`,
          new Date(now.valueOf() - (index % 480) * 3_600_000).toISOString(),
        ),
        model: `model/${index % 6}`,
        conversationId: `c${index % 400}`,
        costUsd: 0.01,
      }),
    );
    await writeFile(
      join(root, "usage", "2026-10.jsonl"),
      `${lines.join("\n")}\n`,
    );
    const usage = new FileUsageTelemetry(root);
    await usage.state(now);

    const times: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      await usage.record(request(`new${index}`, now.toISOString()));
      const started = performance.now();
      await usage.state(now);
      times.push(performance.now() - started);
    }

    // Adding every request up again took about 70 ms here.
    expect(times.sort((a, b) => a - b)[5]).toBeLessThan(20);
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
