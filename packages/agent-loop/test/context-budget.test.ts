/**
 * The budget a conversation is kept under, as the loop keeps it: checked before
 * every model call, older tool results cleared only once they pile up, and the
 * conversation condensed between rounds when it outgrows the budget.
 */

import { describe, expect, it } from "vitest";
import type {
  ContextBudgetChoice,
  ToolInvocationResult,
  WorkspaceTask,
} from "@zhiyin/contract";
import { contextBudgets, typedMessageCharacters } from "@zhiyin/contract";
import { estimatedRequestTokens } from "../src/conversation-context.js";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
  ModelUsage,
} from "@zhiyin/model-client";
import {
  loopAndHost,
  stubDependencies,
  type LoopTestDependencies,
} from "./support.js";

const endless = {
  maximumElapsedMs: 1e12,
  maximumTokens: 1e12,
  maximumProviderCostUsd: 1e9,
  maximumToolRounds: 1_000,
};

function condensingAsked(request: ModelRequest): boolean {
  const last = request.messages.at(-1)?.content;
  return typeof last === "string" && last.includes('kind="condense"');
}

/**
 * A model that works in `rounds` rounds of `calls` calls each, then answers,
 * and answers a request to condense with a summary.
 */
function working(
  rounds: number,
  calls: number,
  requests: ModelRequest[],
  usage?: (request: number) => ModelUsage | undefined,
) {
  let worked = 0;
  return async function* (request: ModelRequest): AsyncIterable<ModelEvent> {
    requests.push(request);
    if (condensingAsked(request)) {
      yield {
        kind: "textDelta",
        text: JSON.stringify({ summary: "Read the report so far." }),
      };
      yield { kind: "done" };
      return;
    }
    const counted = usage?.(requests.length);
    if (counted) yield { kind: "usage", usage: counted };
    worked += 1;
    if (worked > rounds) yield { kind: "textDelta", text: "Done." };
    else
      for (let index = 0; index < calls; index += 1)
        yield {
          kind: "toolCallDelta",
          index,
          callId: `call-${worked}-${index}`,
          name: "read",
          argumentsDelta: "{}",
        };
    yield { kind: "done" };
  };
}

function withReads(
  answer: () => ToolInvocationResult,
  send: (request: ModelRequest) => AsyncIterable<ModelEvent>,
  extra: Partial<LoopTestDependencies> = {},
): LoopTestDependencies {
  const deps = stubDependencies(() => {});
  let kept = 0;
  return {
    ...deps,
    workLimits: endless,
    tools: {
      list: () => [
        { name: "read", description: "Read.", inputSchema: { type: "object" } },
      ],
      inspect: async () => ({
        ok: true,
        action: "Read",
        target: "notes",
        command: "read({})",
        access: "read",
        scope: "workspace",
      }),
      execute: async () => answer(),
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Allowed" }),
    },
    sessions: {
      ...deps.sessions,
      keep: async (_kind, _conversationId, source) => ({
        status: "kept",
        id: `kept-${++kept}`,
        bytes: "text" in source ? Buffer.byteLength(source.text) : 0,
      }),
    },
    model: { ...deps.model, send },
    ...extra,
  };
}

/** Text the size of `tokens` estimated tokens. */
function sized(tokens: number, word = "report "): string {
  return word.repeat(Math.ceil((tokens * 3) / word.length));
}

function results(request: ModelRequest | undefined): string[] {
  return (request?.messages ?? []).flatMap((message) =>
    message.role === "tool" ? [message.content] : [],
  );
}

function rounds(messages: readonly ModelMessage[]): number {
  return messages.filter(
    (message) => message.role === "assistant" && message.toolCalls?.length,
  ).length;
}

function settled(messages: WorkspaceTask["messages"]): WorkspaceTask {
  return {
    id: "task-1",
    title: "Report",
    titleSource: "generated",
    updatedLabel: "Earlier",
    messages,
    actions: [],
    phase: {
      kind: "completed",
      outcome: { title: "Response complete", summary: "Done." },
    },
  };
}

describe("older tool results", () => {
  it("are cleared at most once in 10 rounds of 20k-token results, and every request between repeats the one before it", async () => {
    const requests: ModelRequest[] = [];
    const { host } = loopAndHost(
      withReads(
        () => ({ ok: true, value: { text: sized(6_500) } }),
        working(32, 3, requests),
        {
          modelWindow: {
            model: "wide",
            contextWindow: 1_000_000,
            maximumOutputTokens: 131_072,
          },
          defaultContextBudget: "ultra",
        },
      ),
    );
    const taskId = await host.app.createTask();

    await host.app.start(taskId, "Read the whole report");

    const cleared = requests.flatMap((request, index) =>
      results(request).some((content) => content.includes('kind="cleared"')) &&
      !results(requests[index - 1]).some((content) =>
        content.includes('kind="cleared"'),
      )
        ? [index]
        : [],
    );
    const clearings = requests.flatMap((request, index) => {
      const before = JSON.stringify(requests[index - 1]?.messages ?? []);
      const now = JSON.stringify(request.messages);
      return index > 0 && !now.startsWith(before.slice(0, -1)) ? [index] : [];
    });
    expect(cleared.length).toBeGreaterThan(0);
    expect(clearings.length).toBeGreaterThan(0);
    for (const [index, request] of clearings.entries())
      expect(request - (clearings[index - 1] ?? -10)).toBeGreaterThanOrEqual(
        10,
      );
    expect(results(requests.at(-1)).at(-1)).not.toContain('kind="cleared"');
    expect(host.find(taskId)?.phase.kind).toBe("completed");
  });

  it("are left alone when a request past its budget would free too little by clearing them, and the conversation is condensed instead", async () => {
    const requests: ModelRequest[] = [];
    const { host } = loopAndHost(
      withReads(
        () => ({ ok: true, value: { text: sized(800) } }),
        working(9, 3, requests),
        {
          // A 13,600-token Medium budget: each answer is held to 680 tokens
          // and a round to 2,040, so six rounds cross it while only the first
          // is older than the five protected ones.
          modelWindow: {
            model: "small",
            contextWindow: 16_000,
            maximumOutputTokens: 100,
          },
        },
      ),
    );
    const taskId = await host.app.createTask();

    await host.app.start(taskId, "Read the whole report");

    const asked = requests.findIndex(condensingAsked);
    expect(asked).toBeGreaterThan(0);
    expect(rounds(requests[asked]?.messages ?? [])).toBeGreaterThan(5);
    for (const request of requests)
      expect(JSON.stringify(request.messages)).not.toContain(
        'kind=\\"cleared\\"',
      );
    expect(host.find(taskId)?.compaction?.summary).toBe(
      "Read the report so far.",
    );
    expect(host.find(taskId)?.phase.kind).toBe("completed");
  });
});

describe("a conversation past its budget", () => {
  it("is condensed between rounds of one long run, from the request the provider last cached, and the run goes on", async () => {
    const requests: ModelRequest[] = [];
    const { host } = loopAndHost(
      withReads(
        () => ({ ok: true, value: { text: sized(800) } }),
        working(12, 3, requests),
        {
          modelWindow: {
            model: "small",
            contextWindow: 16_000,
            maximumOutputTokens: 100,
          },
        },
      ),
    );
    const taskId = await host.app.createTask();

    await host.app.start(taskId, "Read the whole report");

    const asked = requests.findIndex(condensingAsked);
    const previous = requests[asked - 1]?.messages ?? [];
    const condensing = requests[asked]?.messages ?? [];
    expect(JSON.stringify(condensing.slice(0, previous.length))).toBe(
      JSON.stringify(previous),
    );
    const after = requests[asked + 1]?.messages ?? [];
    expect(JSON.stringify(after)).toContain("Read the report so far.");
    expect(JSON.stringify(after)).toContain("Read the whole report");
    expect(rounds(after)).toBeGreaterThan(0);
    expect(host.find(taskId)?.compaction?.throughEntryId).toBeDefined();
    expect(host.find(taskId)?.phase.kind).toBe("completed");
  });

  it("of 150k tokens is kept whole on a 1M model's Medium budget, and condensed on Low", async () => {
    const conversation = settled([
      { id: "m1", role: "user", text: sized(150_000), sequence: 0 },
      { id: "m2", role: "assistant", text: "Read.", sequence: 1 },
    ]);
    const condensedOn = async (budget: "low" | "medium") => {
      const requests: ModelRequest[] = [];
      const { host } = loopAndHost(
        withReads(() => ({ ok: true, value: {} }), working(0, 0, requests), {
          modelWindow: {
            model: "wide",
            contextWindow: 1_000_000,
            maximumOutputTokens: 131_072,
          },
          defaultContextBudget: budget,
        }),
      );
      host.app.restore([conversation]);
      await host.app.start("task-1", "Go on");
      return requests.some(condensingAsked);
    };

    expect(await condensedOn("medium")).toBe(false);
    expect(await condensedOn("low")).toBe(true);
  });
});

describe("the size of a request", () => {
  function usage(inputTokens: number, cacheReadTokens?: number): ModelUsage {
    return {
      requestId: `request-${inputTokens}`,
      model: "counted",
      inputTokens,
      outputTokens: 10,
      totalTokens: inputTokens + 10,
      ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    };
  }

  it("is the provider's count, with only what was added since estimated", async () => {
    const seen: (WorkspaceTask["contextUsage"] | undefined)[] = [];
    const requests: ModelRequest[] = [];
    const inner = working(2, 1, requests, (request) =>
      request === 1 ? usage(1_000, 4_000) : undefined,
    );
    const { host } = loopAndHost(
      withReads(
        () => ({ ok: true, value: { text: "short" } }),
        (request) => {
          seen.push(host.find("task-1")?.contextUsage);
          return inner(request);
        },
      ),
    );
    host.restore([settled([])]);

    await host.app.start("task-1", "Read it");

    // Cached tokens left out of the count are added back.
    expect(seen[1]?.measured).toBe(true);
    expect(seen[1]?.totalTokens).toBeGreaterThan(5_000);
    expect(seen[1]?.totalTokens).toBeLessThan(5_200);
    // A request the provider did not count never looks smaller.
    expect(seen[2]?.measured).toBe(true);
    expect(seen[2]?.totalTokens).toBeGreaterThanOrEqual(
      seen[1]?.totalTokens ?? Infinity,
    );
  });

  it("is estimated whole again after a model switch or a rewind", async () => {
    const seen: (WorkspaceTask["contextUsage"] | undefined)[] = [];
    const requests: ModelRequest[] = [];
    const inner = working(1, 1, requests, () => usage(900));
    const { host } = loopAndHost(
      withReads(
        () => ({ ok: true, value: { text: "short" } }),
        (request) => {
          seen.push(host.find("task-1")?.contextUsage);
          return inner(request);
        },
      ),
    );
    host.restore([settled([])]);
    await host.app.start("task-1", "Read it");
    expect(seen[1]?.measured).toBe(true);

    host.window = { model: "another" };
    await host.app.start("task-1", "Again");
    expect(seen[2]?.measured).toBe(false);

    await host.app.start("task-1", "Once more");
    expect(seen[3]?.measured).toBe(true);
    const task = host.find("task-1");
    host.restore([
      {
        ...(task as WorkspaceTask),
        messages: task?.messages.slice(0, 1) ?? [],
        modelHistory: task?.modelHistory?.slice(0, 1) ?? [],
      },
    ]);
    await host.app.start("task-1", "From the start");
    expect(seen.at(-1)?.measured).toBe(false);
  });
});

describe("after condensing", () => {
  it("the model has the person's request word for word, and the files changed before it read again as they are now", async () => {
    const requests: ModelRequest[] = [];
    let worked = 0;
    const deps = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...deps,
      workLimits: endless,
      modelWindow: {
        model: "small",
        contextWindow: 16_000,
        maximumOutputTokens: 100,
      },
      tools: {
        list: () =>
          ["edit", "read"].map((name) => ({
            name,
            description: `The ${name} tool.`,
            inputSchema: { type: "object" },
          })),
        inspect: async (name, args) => ({
          ok: true,
          action: name,
          target: String((args as { path?: string }).path ?? "notes"),
          command: `${name}(...)`,
          access: name === "edit" ? "write" : "read",
          scope: "workspace",
          ...(name === "edit"
            ? {
                changes: [
                  {
                    path: String((args as { path?: string }).path),
                    change: "updated" as const,
                  },
                ],
              }
            : {}),
        }),
        execute: async (name, args) =>
          name === "read_file"
            ? {
                ok: true,
                value: {
                  text: `Current text of ${(args as { path: string }).path}`,
                },
              }
            : {
                ok: true,
                value: { text: name === "read" ? sized(800) : "ok" },
              },
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Allowed" }),
      },
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          if (condensingAsked(request)) {
            yield {
              kind: "textDelta" as const,
              text: JSON.stringify({ summary: "Both files were fixed." }),
            };
          } else if (++worked <= 2)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `call-edit-${worked}`,
              name: "edit",
              argumentsDelta: JSON.stringify({
                path: worked === 1 ? "a.txt" : "b.txt",
              }),
            };
          else if (worked <= 12)
            for (let index = 0; index < 3; index += 1)
              yield {
                kind: "toolCallDelta" as const,
                index,
                callId: `call-read-${worked}-${index}`,
                name: "read",
                argumentsDelta: "{}",
              };
          else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await host.app.createTask();

    await host.app.start(taskId, "Fix both files");

    const asked = requests.findIndex(condensingAsked);
    expect(asked).toBeGreaterThan(0);
    const after = JSON.stringify(requests[asked + 1]?.messages);
    expect(after).toContain(
      "The person's latest request, in full:\\nFix both files",
    );
    expect(after).toContain("Current text of a.txt");
    expect(after).toContain("Current text of b.txt");
    expect(after).toContain("Re-read by Zhiyin after condensing");
    expect(host.find(taskId)?.phase.kind).toBe("completed");
  });
});

describe("the worst case a budget must hold", () => {
  const windows = [
    { model: "128k", contextWindow: 131_072, maximumOutputTokens: 32_768 },
    { model: "262k", contextWindow: 262_144, maximumOutputTokens: 65_536 },
    { model: "1M", contextWindow: 1_000_000, maximumOutputTokens: 131_072 },
  ];
  const cases = windows.flatMap((window) =>
    contextBudgets(window).map(
      ({ budget, targetTokens }) =>
        [window.model, budget, window, targetTokens] as const,
    ),
  );

  it.each(cases)(
    "on a %s window with the %s budget: instructions and tools at their full share, the longest message a person can type, a history at the budget and rounds of the largest results, every request sent fits the budget",
    async (_name, budget: ContextBudgetChoice, window, target) => {
      const requests: ModelRequest[] = [];
      // Instructions and tool definitions at their share of the target, less
      // what the loop's own instructions take.
      const read = {
        name: "read",
        description: sized(target * 0.15 - 1_300, "definition "),
        inputSchema: { type: "object" },
      };
      // A history just under the budget once the rest is added, in rounds.
      const turns = 40;
      const history = Array.from({ length: turns }, (_, index) => [
        {
          id: `u${index}`,
          role: "user" as const,
          text: `Request ${index}: ${sized(target / turns / 4)}`,
          sequence: index * 2,
        },
        {
          id: `a${index}`,
          role: "assistant" as const,
          text: sized((target * 0.75) / turns - target / turns / 4, "answer "),
          sequence: index * 2 + 1,
        },
      ]).flat();
      const deps = withReads(
        // Each answer far past its limit, so every round is at the most a
        // round may hold.
        () => ({ ok: true, value: { text: sized(target) } }),
        working(6, 3, requests),
        { modelWindow: window, defaultContextBudget: budget },
      );
      const { host } = loopAndHost({
        ...deps,
        tools: { ...deps.tools, list: () => [read] },
      });
      host.app.restore([settled(history)]);

      // The longest message a person can send as text; anything longer is
      // sent as a file.
      await host.app.start(
        "task-1",
        "latest ".repeat(typedMessageCharacters / 7),
      );

      const sent = requests.filter((request) => !condensingAsked(request));
      const condensing = requests.filter(condensingAsked);
      const size = (request: ModelRequest) =>
        estimatedRequestTokens(request.messages, request.tools ?? []);
      const fixed = estimatedRequestTokens(
        sent[0]?.messages.slice(0, 1) ?? [],
        sent[0]?.tools ?? [],
      );
      expect(fixed).toBeGreaterThan(target * 0.14);
      expect(fixed).toBeLessThanOrEqual(target * 0.15);
      expect(condensing.length).toBeGreaterThan(0);
      for (const request of sent)
        expect(size(request)).toBeLessThanOrEqual(target);
      // Condensing is itself a request: it fits the window with its answer.
      const reply = Math.min(window.maximumOutputTokens, 16_000);
      for (const request of condensing)
        expect(size(request) + reply).toBeLessThanOrEqual(window.contextWindow);
      expect(host.find("task-1")?.phase.kind).toBe("completed");
    },
  );
});
