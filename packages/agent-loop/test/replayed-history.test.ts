/**
 * What the model is sent across turns: its earlier tool calls and their
 * results where they happened, and each request starting with the whole of the
 * one before it, so a provider's cached copy of that start is reused.
 */

import { describe, expect, it } from "vitest";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  WorkspaceTask,
} from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
} from "@zhiyin/model-client";
import {
  loopAndHost,
  loopFrom,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
  type LoopTestDependencies,
} from "./support.js";
import { prefixBreaks, sharedPrefix } from "./request-prefix.js";

type Tool = {
  readonly inspect?: (
    call: number,
  ) => ToolCallInspection | Promise<ToolCallInspection>;
  readonly execute?: (call: number) => ToolInvocationResult;
};

/**
 * A model that calls `tool` once after each message the person sends and
 * answers once it has the result; `calls` rounds in a row when given.
 */
function callsThenAnswers(tool: string, calls = 1, firstCall = 1) {
  let callNumber = firstCall - 1;
  return async function* (request: ModelRequest): AsyncIterable<ModelEvent> {
    const sinceThePerson =
      request.messages.length - 1 - lastPersonIndex(request);
    const roundsSoFar = request.messages
      .slice(lastPersonIndex(request))
      .filter((message) => message.role === "assistant").length;
    if (sinceThePerson === 0 || roundsSoFar < calls) {
      callNumber += 1;
      yield {
        kind: "toolCallDelta",
        index: 0,
        callId: `call-${callNumber}`,
        name: tool,
        argumentsDelta: JSON.stringify({ note: `note-${callNumber}` }),
      };
    } else
      yield { kind: "textDelta", text: `Answer after call-${callNumber}.` };
    yield { kind: "done" };
  };
}

/** The last message the person wrote, not one Zhiyin sent in their role. */
function lastPersonIndex(request: ModelRequest): number {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (
      message?.role === "user" &&
      typeof message.content === "string" &&
      !message.content.startsWith("<zhiyin-notice")
    )
      return index;
  }
  return 0;
}

function withTools(
  deps: LoopTestDependencies,
  tools: Readonly<Record<string, Tool>>,
  send: (request: ModelRequest) => AsyncIterable<ModelEvent>,
  requests: ModelMessage[][],
  extra: Partial<LoopTestDependencies> = {},
): LoopTestDependencies {
  const counts = new Map<string, number>();
  const count = (name: string) => counts.get(name) ?? 0;
  return {
    ...deps,
    tools: {
      list: () =>
        Object.keys(tools).map((name) => ({
          name,
          description: `The ${name} tool.`,
          inputSchema: { type: "object" },
        })),
      inspect: async (name) => {
        counts.set(name, count(name) + 1);
        return (
          (await tools[name]?.inspect?.(count(name))) ?? {
            ok: true,
            action: `Use ${name}`,
            target: "notes",
            command: `${name}({})`,
            access: "read",
            scope: "workspace",
          }
        );
      },
      execute: async (name) =>
        tools[name]?.execute?.(count(name)) ?? {
          ok: true,
          value: `${name} result ${count(name)}`,
        },
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Allowed" }),
    },
    model: {
      ...deps.model,
      send: (request) => {
        requests.push([...request.messages]);
        return send(request);
      },
    },
    ...extra,
  };
}

function conversationOf(messages: readonly ModelMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) =>
      message.role === "assistant"
        ? message.toolCalls?.length
          ? `calls ${message.toolCalls.map((call) => call.id).join(",")}`
          : `assistant ${message.content}`
        : message.role === "tool"
          ? `result ${message.toolCallId}`
          : `user ${typeof message.content === "string" ? message.content : "[parts]"}`,
    );
}

function savedCopy(tasks: readonly WorkspaceTask[]): WorkspaceTask[] {
  return JSON.parse(JSON.stringify(tasks)) as WorkspaceTask[];
}

describe("earlier tool work in later requests", () => {
  it("sends turn 1's tool calls and results in turn 3, in order, and no evidence block", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopFrom(
      withTools(
        stubDependencies(() => {}),
        { read_note: {} },
        callsThenAnswers("read_note"),
        requests,
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "First");
    await loop.start(taskId, "Second");
    await loop.start(taskId, "Third");

    const third = requests[4] ?? [];
    expect(conversationOf(third)).toEqual([
      "user First",
      "calls call-1",
      "result call-1",
      "assistant Answer after call-1.",
      "user Second",
      "calls call-2",
      "result call-2",
      "assistant Answer after call-2.",
      "user Third",
    ]);
    expect(JSON.stringify(third[3])).toContain("read_note result");
    expect(
      third.some(
        (message) =>
          message.role === "system" &&
          message.content.includes("Previous tool observations"),
      ),
    ).toBe(false);
  });

  it("starts every request of three turns with the whole of the request before it", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopFrom(
      withTools(
        stubDependencies(() => {}),
        { read_note: {} },
        callsThenAnswers("read_note", 2),
        requests,
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "First");
    await loop.start(taskId, "Second");
    await loop.start(taskId, "Third");

    expect(requests).toHaveLength(9);
    expect(prefixBreaks(requests)).toEqual([]);
  });

  it("sends the same tool calls and results after the app restarts", async () => {
    const before: ModelMessage[][] = [];
    const deps = stubDependencies(() => {});
    const first = loopFrom(
      withTools(deps, { read_note: {} }, callsThenAnswers("read_note"), before),
    );
    const taskId = await first.createTask();
    await first.start(taskId, "First");
    await first.start(taskId, "Second");

    const after: ModelMessage[][] = [];
    const { host } = loopAndHost(
      withTools(
        deps,
        { read_note: {} },
        callsThenAnswers("read_note", 1, 3),
        after,
      ),
    );
    host.restore(savedCopy(first.snapshot().tasks));
    await host.app.start(taskId, "Third");

    const lastBefore = before.at(-1) ?? [];
    expect(sharedPrefix(lastBefore, after[0] ?? [])).toBe(lastBefore.length);
    expect(conversationOf(after[0] ?? []).slice(-2)).toEqual([
      "assistant Answer after call-2.",
      "user Third",
    ]);
  });

  it("keeps no quiet correction, and keeps a failure the person was shown", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopFrom(
      withTools(
        stubDependencies(() => {}),
        {
          multi_edit: {
            inspect: (call) =>
              call === 1
                ? {
                    ok: false,
                    reason: "“old text” was not found in notes.md.",
                    correctable: true,
                  }
                : {
                    ok: true,
                    action: "Edit a workspace file",
                    target: "notes.md",
                    command: "multi_edit({})",
                  },
          },
          remove_note: {
            inspect: () => ({ ok: false, reason: "The note is locked." }),
          },
        },
        (() => {
          const edits = callsThenAnswers("multi_edit", 2);
          const removals = callsThenAnswers("remove_note", 1, 10);
          let turn = 0;
          return (request: ModelRequest) => {
            if (lastPersonIndex(request) === request.messages.length - 1)
              turn += 1;
            return turn === 1 ? edits(request) : removals(request);
          };
        })(),
        requests,
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");
    await loop.start(taskId, "Remove the note");
    await loop.start(taskId, "Thanks");

    const saved = JSON.stringify(loop.snapshot().tasks[0]?.modelHistory);
    expect(saved).not.toContain("was not found");
    expect(saved).toContain("The note is locked.");
    const last = JSON.stringify(requests.at(-1));
    expect(last).not.toContain("was not found");
    expect(last).toContain("The note is locked.");
  });

  it("carries on from the history already sent after Continue", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopFrom(
      withTools(
        stubDependencies(() => {}),
        { read_note: {} },
        callsThenAnswers("read_note", 2),
        requests,
        {
          workLimits: { maximumToolRounds: 1 },
          newUserInputId: () => "budget-1",
        },
      ),
    );
    const taskId = await loop.createTask();
    const running = loop.start(taskId, "Read every note");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    await loop.resolveUserInput(taskId, "budget-1", {
      answers: [{ questionId: "work-budget", answerIds: ["continue"] }],
    });
    await running;

    expect(prefixBreaks(requests)).toEqual([]);
    const afterContinue = requests[2] ?? [];
    expect(conversationOf(afterContinue).slice(1, 5)).toEqual([
      "calls call-1",
      "result call-1",
      "calls call-2",
      "result call-2",
    ]);
    expect(JSON.stringify(afterContinue.at(-1))).toContain(
      'kind=\\"renewal\\"',
    );
  });
});

describe("pictures in later requests", () => {
  it("changes the start of the request once when pictures 9 to 12 arrive, at picture 9", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopFrom(
      withTools(
        stubDependencies(() => {}),
        {
          capture: {
            execute: (call) => ({
              ok: true,
              value: "[image 1, shown separately]",
              images: [{ mediaType: "image/png", data: `PICTURE${call}` }],
            }),
          },
        },
        callsThenAnswers("capture", 12),
        requests,
        { acceptsImages: true },
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Watch the page change");

    // Request n was sent after picture n arrived.
    expect(prefixBreaks(requests).map((change) => change.request)).toEqual([9]);
    const carried = (messages: readonly ModelMessage[]) =>
      messages.filter(
        (message) =>
          message.role === "user" &&
          typeof message.content !== "string" &&
          message.content.some((part) => part.kind === "image"),
      ).length;
    expect(carried(requests[8] ?? [])).toBe(8);
    expect(carried(requests[9] ?? [])).toBe(4);
    expect(carried(requests[12] ?? [])).toBe(7);
  });

  it("sends a saved picture again after the app restarts, and says so when it is gone", async () => {
    const stored = new Map<string, { mediaType: string; data: string }>();
    const deps = stubDependencies(() => {});
    const sessions = {
      ...deps.sessions,
      savePicture: async (
        _conversationId: string,
        image: { mediaType: string; data: string },
      ) => {
        stored.set(`picture-${stored.size + 1}`, image);
        return `picture-${stored.size}`;
      },
      readPicture: async (source: string) => {
        const image = stored.get(source);
        return image
          ? { status: "ready" as const, ...image }
          : { status: "missing" as const, reason: "It was removed." };
      },
    };
    const capture = {
      capture: {
        execute: (call: number) => ({
          ok: true as const,
          value: "[image 1, shown separately]",
          images: [{ mediaType: "image/png", data: `PICTURE${call}` }],
        }),
      },
    };
    const before: ModelMessage[][] = [];
    const first = loopFrom(
      withTools(deps, capture, callsThenAnswers("capture"), before, {
        acceptsImages: true,
        sessions,
      }),
    );
    const taskId = await first.createTask();
    await first.start(taskId, "Look at the page");
    const saved = savedCopy(first.snapshot().tasks);

    const after: ModelMessage[][] = [];
    const { host } = loopAndHost(
      withTools(deps, capture, callsThenAnswers("capture", 1, 2), after, {
        acceptsImages: true,
        sessions,
      }),
    );
    host.restore(saved);
    await host.app.start(taskId, "Again");

    const lastBefore = before.at(-1) ?? [];
    expect(sharedPrefix(lastBefore, after[0] ?? [])).toBe(lastBefore.length);
    expect(JSON.stringify(saved)).not.toContain("PICTURE1");

    stored.clear();
    const gone: ModelMessage[][] = [];
    const { host: later } = loopAndHost(
      withTools(deps, capture, callsThenAnswers("capture", 1, 3), gone, {
        acceptsImages: true,
        sessions,
      }),
    );
    later.restore(saved);
    await later.app.start(taskId, "Once more");
    expect(JSON.stringify(gone[0])).not.toContain("PICTURE1");
    expect(JSON.stringify(gone[0])).toContain("It was removed.");
  });
});

describe("what each request asks the provider to keep", () => {
  it("names the conversation on every request and marks where the next one will repeat this one", async () => {
    const sent: ModelRequest[] = [];
    const deps = withTools(
      stubDependencies(() => {}),
      { read_note: {} },
      callsThenAnswers("read_note"),
      [],
    );
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: (request) => {
          sent.push(request);
          return deps.model.send(request);
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "First");
    await loop.start(taskId, "Second");

    expect(sent.map((request) => request.session)).toEqual(
      sent.map(() => taskId),
    );
    const fixedEnd =
      (sent[0]?.messages.findIndex((message) => message.role !== "system") ??
        0) - 1;
    for (const [index, request] of sent.entries()) {
      const last = request.messages.length - 1;
      const previousLast = (sent[index - 1]?.messages.length ?? 0) - 1;
      expect(request.cacheAfter).toEqual(
        [...new Set([fixedEnd, ...(index ? [previousLast] : []), last])].sort(
          (left, right) => left - right,
        ),
      );
    }
  });
});

describe("what changes the start of a request, on purpose", () => {
  it("takes a quietly corrected proposal back out once the tool succeeds", async () => {
    const requests: ModelMessage[][] = [];
    const loop = loopFrom(
      withTools(
        stubDependencies(() => {}),
        {
          multi_edit: {
            inspect: (call) =>
              call === 1
                ? {
                    ok: false,
                    reason: "“old text” was not found in notes.md.",
                    correctable: true,
                  }
                : {
                    ok: true,
                    action: "Edit a workspace file",
                    target: "notes.md",
                    command: "multi_edit({})",
                  },
          },
        },
        callsThenAnswers("multi_edit", 2),
        requests,
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");
    await loop.start(taskId, "Thanks");

    expect(prefixBreaks(requests).map((change) => change.request)).toEqual([2]);
  });

  it("changes the system prompt's date when the day changes, and nothing else", async () => {
    const requests: ModelMessage[][] = [];
    let today = new Date("2026-09-02T23:59:00.000Z");
    const loop = loopFrom(
      withTools(
        stubDependencies(() => {}),
        { read_note: {} },
        callsThenAnswers("read_note"),
        requests,
        { now: () => today },
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "First");
    today = new Date("2026-09-03T00:01:00.000Z");
    await loop.start(taskId, "Second");

    expect(prefixBreaks(requests)).toEqual([{ request: 2, at: 0 }]);
    expect(requests[2]?.slice(1, requests[1]?.length)).toEqual(
      requests[1]?.slice(1),
    );
  });

  it("puts the summary in place of what a condensing covered, and changes the start of requests only there", async () => {
    const requests: ModelMessage[][] = [];
    let answers = 0;
    const loop = loopFrom(
      withTools(
        stubDependencies(() => {}),
        { read_note: {} },
        async function* (request: ModelRequest) {
          const last = request.messages.at(-1);
          if (JSON.stringify(last).includes('kind=\\"condense\\"'))
            yield {
              kind: "textDelta" as const,
              text: JSON.stringify({
                summary: "The person asked for the first note.",
              }),
            };
          else if (last?.role === "user")
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `call-${answers + 1}`,
              name: "read_note",
              argumentsDelta: "{}",
            };
          // The first answer is long enough that the next turn passes the
          // budget.
          else
            yield {
              kind: "textDelta" as const,
              text: ++answers === 1 ? "padding ".repeat(1_800) : "Answered.",
            };
          yield { kind: "done" as const };
        },
        requests,
        {
          // A 6,800-token Medium budget.
          modelWindow: {
            model: "small",
            contextWindow: 8_000,
            maximumOutputTokens: 100,
          },
        },
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "First");
    await loop.start(taskId, `Second ${"padding ".repeat(150)}`);
    await loop.start(taskId, "Third");

    const condensing = requests.findIndex((messages) =>
      JSON.stringify(messages.at(-1)).includes('kind=\\"condense\\"'),
    );
    expect(condensing).toBeGreaterThan(0);
    expect(prefixBreaks(requests).map((change) => change.request)).toEqual([
      condensing + 1,
    ]);
    const afterCondensing = conversationOf(requests[condensing + 1] ?? []);
    expect(afterCondensing[0]).toContain('kind="summary"');
    expect(afterCondensing[0]).toContain(
      "The person asked for the first note.",
    );
    expect(afterCondensing[1]).toMatch(/^user Second/);
    expect(
      afterCondensing.some((line) => line.startsWith("assistant padding")),
    ).toBe(false);
  });

  it("changes the fixed start once when a plugin is activated", async () => {
    const requests: ModelMessage[][] = [];
    const deps = stubDependencies(() => {});
    let activated = false;
    const loop = loopFrom(
      withTools(
        deps,
        {},
        async function* (request: ModelRequest) {
          if (!activated) {
            activated = true;
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "call-1",
              name: "activate_plugin",
              argumentsDelta: JSON.stringify({ id: "writing" }),
            };
          } else yield { kind: "textDelta" as const, text: "Done." };
          void request;
          yield { kind: "done" as const };
        },
        requests,
        {
          plugins: pluginsOffering([
            pluginOffering({
              name: "writing",
              skills: [
                {
                  id: "writer",
                  description: "Write clearly",
                  instructions: "Use short sentences.",
                },
              ],
            }),
          ]),
        },
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Help me write");
    await loop.start(taskId, "Again");

    expect(prefixBreaks(requests)).toEqual([{ request: 2, at: 1 }]);
  });
});
