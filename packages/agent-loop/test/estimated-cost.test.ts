/**
 * Where a provider reports no cost, the model client estimates one from the
 * shipped price list (ADR 0015). The estimate is kept with the answer and in
 * the usage history, in its own currency and named as an estimate, never as a
 * reported cost.
 */

import { describe, expect, it } from "vitest";
import type { ModelEvent } from "@zhiyin/model-client";
import { loopAndHost, stubDependencies, until } from "./support.js";

const estimatedCost = {
  amount: 0.004,
  currency: "CNY",
  priceList: "2026-10-09",
};

async function* answersWithAnEstimate(): AsyncIterable<ModelEvent> {
  yield { kind: "textDelta", text: "Answer." };
  yield {
    kind: "usage",
    usage: {
      requestId: "request-1",
      model: "deepseek-v4-pro",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      estimatedCost,
    },
  };
  yield {
    kind: "done",
    finishReason: "stop",
    response: {
      requestId: "request-1",
      model: "deepseek-v4-pro",
      finishReason: "stop",
      termination: "finishReason",
      complete: true,
    },
  };
}

describe("an estimated cost", () => {
  it("is kept with the answer and in the usage history, as an estimate", async () => {
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
      model: { ...deps.model, send: answersWithAnEstimate },
    });
    const taskId = await host.app.createTask();

    await host.app.start(taskId, "A question");
    await until(() => host.usage.length > 0);

    const [response] = host.app.snapshot().tasks[0]?.modelResponses ?? [];
    expect(response?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      estimatedCost,
    });
    expect(host.usage[0]).toMatchObject({ estimatedCost });
    expect(host.usage[0]).not.toHaveProperty("costUsd");
  });
});
