import { describe, expect, it } from "vitest";
import { estimatedTokens, type WorkspaceTask } from "@zhiyin/contract";
import { ModelClientError, type ModelRequest } from "@zhiyin/model-client";
import {
  loopAndHost,
  stubDependencies,
  type TestHost,
  type TurnTestApp,
} from "./support.js";

/** What the catalogue lists: more than the provider will really take. */
const listed = {
  model: "listed-64k",
  contextWindow: 64_000,
  maximumOutputTokens: 1_000,
};

/** Five older rounds worth condensing, about 6,000 tokens of them. */
const earlier: WorkspaceTask["messages"] = Array.from(
  { length: 5 },
  (_, round) => [
    {
      id: `u${round}`,
      role: "user" as const,
      text: `Read part ${round}`,
      sequence: round * 2,
    },
    {
      id: `a${round}`,
      role: "assistant" as const,
      text: `PART ${round} ${"OLDER MATERIAL ".repeat(240)}`,
      sequence: round * 2 + 1,
    },
  ],
).flat();

const noLongerFits =
  "This conversation no longer fits the selected model, even after condensing it.";

function asksToCondense(request: ModelRequest): boolean {
  const last = request.messages.at(-1)?.content;
  return typeof last === "string" && last.includes('kind="condense"');
}

/** The request's size as the fake provider counts it. */
const sizeOf = (request: ModelRequest) =>
  estimatedTokens(JSON.stringify(request.messages)) +
  estimatedTokens(JSON.stringify(request.tools ?? []));

function tooLong(options: { sent?: number; limit?: number } = {}) {
  return new ModelClientError(
    "contextExceeded",
    "The request is too large for the selected model.",
    Object.keys(options).length ? { tokens: options } : {},
  );
}

type Provider = {
  readonly requests: ModelRequest[];
  readonly refused: ModelRequest[];
};

/**
 * A provider whose real limit is below the listed window. `limit` decides it
 * from the first request it is sent; `refuse` decides what it says when it
 * refuses one, and whether it refuses at all.
 */
function refusing(
  options: {
    readonly limit?: (first: number) => number;
    readonly error?: (size: number, limit: number) => ModelClientError;
    readonly always?: boolean;
    readonly textFirst?: boolean;
  } = {},
): { loop: TurnTestApp; host: TestHost; provider: Provider } {
  const provider: Provider = { requests: [], refused: [] };
  let limit: number | undefined;
  const deps = stubDependencies(() => {});
  const { host } = loopAndHost({
    ...deps,
    modelWindow: listed,
    model: {
      ...deps.model,
      send: async function* (request: ModelRequest) {
        provider.requests.push(request);
        const size = sizeOf(request);
        limit ??= (options.limit ?? ((first) => Math.floor(first * 0.8)))(size);
        const condensing = asksToCondense(request);
        if (options.textFirst && !condensing)
          yield { kind: "textDelta" as const, text: "Starting the answer" };
        if (size > limit || (options.always && !condensing)) {
          provider.refused.push(request);
          throw (options.error ?? ((sent, at) => tooLong({ sent, limit: at })))(
            size,
            limit,
          );
        }
        yield {
          kind: "textDelta" as const,
          text: condensing
            ? JSON.stringify({ summary: "The older material was read." })
            : "Carried on.",
        };
        yield { kind: "done" as const };
      },
    },
  });
  const loop = host.app;
  loop.restore([
    {
      id: "task-1",
      title: "Long work",
      titleSource: "manual",
      updatedLabel: "Earlier",
      messages: earlier,
      actions: [],
      phase: { kind: "interrupted" },
    },
  ]);
  return { loop, host, provider };
}

const task = (loop: TurnTestApp) => loop.snapshot().tasks[0];

describe("a request the provider refuses as too long", () => {
  it("is recovered once: condensed, noted as following the refusal, and the same step sent again", async () => {
    const { loop, provider } = refusing();

    await loop.start("task-1", "Continue");

    expect(task(loop)?.phase.kind).toBe("completed");
    expect(provider.refused).toHaveLength(1);
    const [first, ...rest] = provider.requests.map(asksToCondense);
    expect([first, rest.at(-1), rest.slice(0, -1).every(Boolean)]).toEqual([
      false,
      false,
      true,
    ]);
    expect(task(loop)?.condensings).toEqual([
      expect.objectContaining({ outcome: "condensed", afterRefusal: true }),
    ]);
    expect(JSON.stringify(provider.requests.at(-1)?.messages)).toContain(
      "Continue",
    );
  });

  it("plans with the provider's stated limit, so the next ten turns are not refused", async () => {
    const { loop, host, provider } = refusing();

    await loop.start("task-1", "Continue");
    const stated = Math.floor(sizeOf(provider.requests[0]!) * 0.8);
    expect(host.window.contextWindow).toBe(stated);
    for (let turn = 1; turn <= 10; turn += 1)
      await loop.start("task-1", `Turn ${turn}: ${"detail ".repeat(300)}`);

    expect(provider.refused).toHaveLength(1);
    expect(task(loop)?.phase.kind).toBe("completed");
  });

  it("without a stated limit, plans with nine tenths of what the provider said was sent", async () => {
    const { loop, host, provider } = refusing({
      error: (size) => tooLong({ sent: size }),
    });

    await loop.start("task-1", "Continue");

    expect(host.window.contextWindow).toBe(
      Math.floor(sizeOf(provider.refused[0]!) * 0.9),
    );
    expect(task(loop)?.phase.kind).toBe("completed");
  });

  it("with no counts at all, plans below the size it estimated for the refused request", async () => {
    const { loop, host, provider } = refusing({ error: () => tooLong() });

    await loop.start("task-1", "Continue");

    expect(host.window.contextWindow).toBeLessThan(
      sizeOf(provider.refused[0]!),
    );
    expect(task(loop)?.phase.kind).toBe("completed");
  });

  it("ends the turn saying the conversation no longer fits when the retried step is refused too", async () => {
    const { loop, provider } = refusing({ always: true });

    await loop.start("task-1", "Continue");

    expect(provider.refused).toHaveLength(2);
    expect(task(loop)?.condensings).toEqual([
      expect.objectContaining({ afterRefusal: true }),
    ]);
    expect(task(loop)?.phase).toEqual({ kind: "failed", reason: noLongerFits });
  });

  it("is not recovered once the answer has begun to show", async () => {
    const { loop, host, provider } = refusing({
      always: true,
      textFirst: true,
    });

    await loop.start("task-1", "Continue");

    expect(provider.requests.filter(asksToCondense)).toHaveLength(0);
    expect(host.window.contextWindow).toBe(listed.contextWindow);
    expect(task(loop)?.phase.kind).toBe("failed");
  });
});

describe("a request refused for something other than its size", () => {
  it("is never condensed, and leaves the window as listed", async () => {
    const { loop, host, provider } = refusing({
      always: true,
      error: () =>
        new ModelClientError(
          "requestRejected",
          "The provider rejected an invalid parameter.",
        ),
    });

    await loop.start("task-1", "Continue");

    expect(provider.requests.filter(asksToCondense)).toHaveLength(0);
    expect(host.window.contextWindow).toBe(listed.contextWindow);
    expect(task(loop)?.phase).toEqual({
      kind: "failed",
      reason: "The provider rejected an invalid parameter.",
    });
  });
});
