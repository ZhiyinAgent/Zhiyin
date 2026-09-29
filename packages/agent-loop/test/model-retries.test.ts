import { describe, expect, it } from "vitest";
import type { AppEvent, WorkspaceTask } from "@zhiyin/contract";
import {
  OpenRouterModelClient,
  type ModelEvent,
  type ModelFetch,
  type ModelFetchResponse,
} from "@zhiyin/model-client";
import { loopFrom, stubDependencies, until } from "./support.js";

/**
 * ADR 0049. A brief provider failure no longer fails the turn. Text is shown a
 * few seconds behind the model, so a failure before anything was shown is
 * retried unseen; after text has been shown, the answer is withdrawn and
 * started again openly, never continued and never duplicated.
 *
 * These drive the real model client over a scripted connection, because the
 * behaviour is the client's retrying and the turn's taking back together.
 */

const encoder = new TextEncoder();
const chunk = (value: unknown) =>
  encoder.encode(`data: ${JSON.stringify(value)}\n\n`);

function answering(text: string): ModelFetchResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      yield chunk({
        id: "gen-1",
        choices: [{ index: 0, delta: { content: text } }],
      });
      yield chunk({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
      yield encoder.encode("data: [DONE]\n\n");
    })(),
  };
}

function partThenFailing(
  text: string,
  failure: { readonly code: number; readonly type: string },
): ModelFetchResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      yield chunk({ choices: [{ index: 0, delta: { content: text } }] });
      yield chunk({
        error: {
          code: failure.code,
          message: "The upstream stopped.",
          metadata: { error_type: failure.type },
        },
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
      });
    })(),
  };
}

const rateLimited = { code: 429, type: "rate_limit_exceeded" };

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

/**
 * Answers each request with a fresh copy of the next response in line, the
 * last one repeating, and counts requests. Fresh, because a body is read once.
 */
function inTurn(...responses: (() => ModelFetchResponse)[]) {
  const fetcher = Object.assign(
    (async () => {
      const next = responses[Math.min(fetcher.requests, responses.length - 1)]!;
      fetcher.requests += 1;
      return next();
    }) as ModelFetch,
    { requests: 0 },
  );
  return fetcher;
}

function setUp(
  send: (
    request: Parameters<OpenRouterModelClient["send"]>[0],
  ) => AsyncIterable<ModelEvent>,
  options: { readonly revealDelayMs?: number } = {},
) {
  const seen: AppEvent[] = [];
  const deps = stubDependencies((event) => seen.push(event));
  const loop = loopFrom({
    ...deps,
    ...(options.revealDelayMs === undefined
      ? {}
      : { revealDelayMs: options.revealDelayMs }),
    model: { ...deps.model, send },
  });
  const announced = () =>
    seen.flatMap((event) =>
      event.kind === "taskChanged" ? [event.data as WorkspaceTask] : [],
    );
  return { loop, announced };
}

function over(fetcher: ModelFetch, waits: "instant" | "real" = "instant") {
  const client = new OpenRouterModelClient({
    apiKey: async () => "key",
    model: "z-ai/glm-5.3-flash",
    fetcher,
    ...(waits === "instant"
      ? { retry: { wait: async () => {}, random: () => 0 } }
      : {}),
  });
  return (request: Parameters<OpenRouterModelClient["send"]>[0]) =>
    client.send(request);
}

function assistantTexts(task: WorkspaceTask | undefined) {
  return (task?.messages ?? [])
    .filter((message) => message.role === "assistant")
    .map((message) => message.text);
}

describe("a model request refused before it streamed", () => {
  it("is sent again, and the turn completes with one answer and the retries recorded", async () => {
    const fetcher = inTurn(
      () => refused(429),
      () => refused(429),
      () => answering("Complete"),
    );
    const { loop } = setUp(over(fetcher));
    const taskId = await loop.createTask();

    await loop.start(taskId, "Answer me");

    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    expect(assistantTexts(task)).toEqual(["Complete"]);
    expect(task?.modelResponses?.[0]?.retries).toEqual([
      { failure: "rateLimited", delayMs: 0, kind: "silent" },
      { failure: "rateLimited", delayMs: 0, kind: "silent" },
    ]);
  });

  it("publishes the provider retry deadline and which attempt is next", async () => {
    const { loop, announced } = setUp(async function* () {
      yield {
        kind: "retrying",
        attempt: 2,
        maximumAttempts: 5,
        delayMs: 8_000,
        reason: "rateLimited",
        message: "Rate limited.",
      };
      yield { kind: "textDelta", text: "Complete" };
      yield { kind: "done", finishReason: "stop" };
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Answer me");

    expect(
      announced().some(
        (entry) =>
          entry.phase.kind === "working" &&
          entry.phase.note === "The model is busy. Trying again" &&
          entry.phase.retry?.count === "2 of 5" &&
          Math.abs(Date.parse(entry.phase.retry.readyAt) - Date.now() - 8_000) <
            1_000,
      ),
    ).toBe(true);
  });

  it("stops waiting the moment the person stops the turn", async () => {
    const fetcher = inTurn(
      () => refused(429, "30"),
      () => answering("never reached"),
    );
    const { loop } = setUp(over(fetcher, "real"));
    const taskId = await loop.createTask();
    const turn = loop.start(taskId, "Answer me");
    await until(() => fetcher.requests === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const stopped = Date.now();
    await loop.cancel(taskId);
    await turn;

    expect(Date.now() - stopped).toBeLessThan(100);
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
  });
});

describe("a stream that fails while its text is still held back", () => {
  it("is started again unseen, and the partial text is never shown or saved", async () => {
    const fetcher = inTurn(
      () => partThenFailing("Partial", rateLimited),
      () => answering("Complete"),
    );
    const { loop, announced } = setUp(over(fetcher));
    const taskId = await loop.createTask();

    await loop.start(taskId, "Answer me");

    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    expect(assistantTexts(task)).toEqual(["Complete"]);
    expect(
      announced().some((entry) =>
        entry.messages.some((message) => message.text.includes("Partial")),
      ),
    ).toBe(false);
    expect(task?.modelResponses?.[0]?.retries).toEqual([
      { failure: "rateLimited", delayMs: 0, kind: "silent" },
    ]);
  });
});

describe("a stream that fails after its text was shown", () => {
  it("withdraws the shown text and starts the answer again openly", async () => {
    const fetcher = inTurn(
      () => partThenFailing("Partial", rateLimited),
      () => answering("Complete"),
    );
    const { loop, announced } = setUp(over(fetcher), { revealDelayMs: 0 });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Answer me");

    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    expect(assistantTexts(task)).toEqual(["Complete"]);
    expect(
      announced().some(
        (entry) =>
          entry.phase.kind === "working" &&
          entry.phase.note ===
            "The answer was interrupted. Starting it again" &&
          entry.phase.retry?.count === "1 of 3" &&
          !entry.messages.some((message) => message.text === "Partial"),
      ),
    ).toBe(true);
    expect(task?.modelResponses?.[0]?.retries).toEqual([
      {
        failure: "rateLimited",
        delayMs: 0,
        kind: "restart",
        discardedCharacters: "Partial".length,
      },
    ]);
  });

  it("gives up after three restarts, keeping what the last attempt showed", async () => {
    const fetcher = inTurn(() => partThenFailing("Partial", rateLimited));
    const { loop } = setUp(over(fetcher), { revealDelayMs: 0 });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Answer me");

    const task = loop.snapshot().tasks[0];
    expect(fetcher.requests).toBe(4);
    expect(task?.phase).toEqual({
      kind: "failed",
      reason: "The upstream stopped.",
    });
    expect(assistantTexts(task)).toEqual(["Partial"]);
  });

  it("is not started again for a content-policy stop", async () => {
    const fetcher = inTurn(
      () =>
        partThenFailing("Partial", {
          code: 403,
          type: "content_policy_violation",
        }),
      () => answering("never reached"),
    );
    const { loop } = setUp(over(fetcher));
    const taskId = await loop.createTask();

    await loop.start(taskId, "Answer me");

    expect(fetcher.requests).toBe(1);
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({ kind: "failed" });
  });
});

describe("text held back behind the model", () => {
  it("is released at once when the round ends", async () => {
    const { loop } = setUp(over(inTurn(() => answering("Complete"))), {
      revealDelayMs: 60_000,
    });
    const taskId = await loop.createTask();
    const started = Date.now();

    await loop.start(taskId, "Answer me");

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(assistantTexts(loop.snapshot().tasks[0])).toEqual(["Complete"]);
  });

  it("is shown while the round is still running, once held long enough", async () => {
    const { loop, announced } = setUp(
      async function* () {
        yield { kind: "textDelta", text: "Hello" };
        await new Promise((resolve) => setTimeout(resolve, 150));
        yield { kind: "textDelta", text: " world" };
        yield { kind: "done", finishReason: "stop" };
      },
      { revealDelayMs: 20 },
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Answer me");

    expect(
      announced().some(
        (entry) =>
          entry.phase.kind === "working" &&
          entry.messages.some((message) => message.text === "Hello"),
      ),
    ).toBe(true);
  });
});
