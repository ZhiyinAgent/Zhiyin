/**
 * A request that is stopped, or fails once its answer has begun, is paid for
 * all the same, and no provider's count of it ever arrives. It goes in the
 * usage history as what Zhiyin counted of it; a request nothing came back from
 * does not.
 */

import { describe, expect, it } from "vitest";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { loopAndHost, stubDependencies, until } from "./support.js";

const estimatedCost = {
  amount: 0.004,
  currency: "USD",
  priceList: "2026-10-09",
};

type Counted = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly reasoningTokens?: number;
};

/** Waits for the caller to give up on the request, as a held stream would. */
const untilStopped = (request: ModelRequest) =>
  new Promise<never>((_resolve, reject) => {
    request.signal?.addEventListener(
      "abort",
      () => reject(request.signal?.reason as Error),
      { once: true },
    );
  });

function setUp(
  answer: (request: ModelRequest, number: number) => AsyncIterable<ModelEvent>,
) {
  const counted: Counted[] = [];
  let requests = 0;
  const deps = stubDependencies(() => {});
  const { host } = loopAndHost({
    ...deps,
    revealDelayMs: 0,
    model: {
      ...deps.model,
      send: (request) => answer(request, (requests += 1)),
      uncounted: async (usage: Counted) => {
        counted.push(usage);
        return {
          requestId: `uncounted-${counted.length}`,
          model: "a-model",
          ...usage,
          totalTokens: usage.inputTokens + usage.outputTokens,
          estimatedCost,
        };
      },
    },
  });
  return { host, counted };
}

describe("a request that ends before the provider counts it", () => {
  it("is recorded as what it sent and received, when the person stops it", async () => {
    let reasoning = false;
    const { host, counted } = setUp(async function* (request) {
      yield { kind: "reasoningDelta", text: "x".repeat(3_000) };
      reasoning = true;
      await untilStopped(request);
    });
    const taskId = await host.app.createTask();
    const turn = host.app.start(taskId, "A question");
    await until(() => reasoning);

    await host.app.cancel(taskId);
    await turn;

    expect(counted).toEqual([
      {
        inputTokens: expect.any(Number),
        outputTokens: 1_000,
        reasoningTokens: 1_000,
      },
    ]);
    expect(counted[0]?.inputTokens).toBeGreaterThan(0);
    expect(host.usage).toEqual([
      expect.objectContaining({
        requestId: "uncounted-1",
        conversationId: taskId,
        purpose: "turn",
        outputTokens: 1_000,
        estimatedCost,
      }),
    ]);
  });

  it("counts a request sent again silently on its own, after the failed one reported its usage", async () => {
    const usage = (requestId: string) => ({
      kind: "usage" as const,
      usage: {
        requestId,
        model: "a-model",
        inputTokens: 40,
        outputTokens: 0,
        totalTokens: 40,
      },
    });
    const repeat = {
      delayMs: 0,
      reason: "unexplainedError" as const,
      message: "Provider returned error",
    };
    const { host, counted } = setUp(async function* () {
      // The first attempt reports its usage, then fails before any answer.
      yield usage("request-1");
      yield { kind: "retrying", attempt: 2, maximumAttempts: 5, ...repeat };
      // The second begins an answer, then is cut off and started again.
      yield { kind: "textDelta", text: "x".repeat(300) };
      yield { kind: "restarting", restart: 1, maximumRestarts: 3, ...repeat };
      yield { kind: "textDelta", text: "Done." };
      yield usage("request-3");
      yield { kind: "done", finishReason: "stop" };
    });
    const taskId = await host.app.createTask();

    await host.app.start(taskId, "A question");

    // The cut-off second attempt is estimated: the provider never counted it.
    expect(counted).toEqual([
      expect.objectContaining({ outputTokens: expect.any(Number) }),
    ]);
    expect(counted[0]?.outputTokens).toBeGreaterThan(0);
  });

  it("is not recorded when nothing of an answer arrived", async () => {
    const { host, counted } = setUp(async function* () {
      yield* [];
      throw new Error("The connection was refused.");
    });
    const taskId = await host.app.createTask();

    await host.app.start(taskId, "A question");

    expect(host.app.snapshot().tasks[0]?.phase.kind).toBe("failed");
    expect(counted).toEqual([]);
    expect(host.usage).toEqual([]);
  });

  it("takes what the request before it sent as read from the cache", async () => {
    let answering = false;
    const { host, counted } = setUp(async function* (request, number) {
      if (number === 1) {
        yield { kind: "textDelta", text: "First answer." };
        yield {
          kind: "usage",
          usage: {
            requestId: "request-1",
            model: "a-model",
            inputTokens: 40,
            outputTokens: 5,
            totalTokens: 45,
          },
        };
        yield { kind: "done", finishReason: "stop" };
        return;
      }
      yield { kind: "textDelta", text: "Second" };
      answering = true;
      await untilStopped(request);
    });
    const taskId = await host.app.createTask();
    await host.app.start(taskId, "A question");

    const turn = host.app.start(taskId, "Another");
    await until(() => answering);
    await host.app.cancel(taskId);
    await turn;

    expect(counted).toHaveLength(1);
    expect(counted[0]?.cacheReadTokens).toBe(40);
    expect(counted[0]?.inputTokens).toBeGreaterThan(40);
    expect(counted[0]?.reasoningTokens).toBeUndefined();
  });
});
