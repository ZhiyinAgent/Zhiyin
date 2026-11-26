import { describe, expect, it } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import {
  fakeCorrectionsLog,
  type FakeCorrectionsLog,
} from "@zhiyin/corrections-log/testing";
import { stubDependencies, loopFrom } from "./support.js";
import { sharedPrefix } from "./request-prefix.js";

/**
 * A tool that refuses the first `failures` attempts as model-correctable and
 * accepts everything after that, so a test can watch what the person and the
 * model are each shown while the model corrects itself.
 */
function selfCorrectingTool(failures: number, correctable = true) {
  let attempts = 0;
  return {
    attempts: () => attempts,
    registry: {
      list: () => [
        {
          name: "multi_edit",
          description: "Edit files.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => {
        attempts += 1;
        return attempts <= failures
          ? {
              ok: false,
              reason: "“old text” was not found in notes.md.",
              ...(correctable ? { correctable: true } : {}),
            }
          : {
              ok: true,
              action: "Edit a workspace file",
              target: "notes.md",
              command: "multi_edit({})",
            };
      },
      execute: async () => ({ ok: true as const, value: { edited: true } }),
    },
  };
}

/** With `numbered`, each call sends its own number, as {"call": 3}. */
function repeatsOneCall(
  name: string,
  finalText: string,
  calls: number,
  numbered = false,
) {
  let turn = 0;
  return async function* (request: ModelRequest) {
    turn += 1;
    if (turn <= calls) {
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: `call-${turn}`,
        name,
        argumentsDelta: numbered ? JSON.stringify({ call: turn }) : "{}",
      };
    } else {
      yield { kind: "textDelta" as const, text: finalText };
    }
    void request;
    yield { kind: "done" as const };
  };
}

describe("AgentLoop quiet corrections", () => {
  it("lets the model correct a rejected edit without showing it to the person", async () => {
    const tool = selfCorrectingTool(2);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: repeatsOneCall("multi_edit", "The edit is in place.", 3),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");

    // Two refusals, then the accepted call.
    expect(tool.attempts()).toBeGreaterThanOrEqual(3);
    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    // Nothing about the two dead ends reached the person.
    expect(task?.actions?.map((action) => action.status)).toEqual([
      "completed",
    ]);
    expect(JSON.stringify(task)).not.toContain("was not found");
  });

  it("removes the corrected attempts from what the model is asked next", async () => {
    const tool = selfCorrectingTool(2);
    const deps = stubDependencies(() => {});
    const requests: ModelMessage[][] = [];
    const loop = loopFrom({
      ...deps,
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: (() => {
          const inner = repeatsOneCall("multi_edit", "Done.", 3);
          return async function* (request: ModelRequest) {
            requests.push([...request.messages]);
            yield* inner(request);
          };
        })(),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");

    // While correcting, the model does see its own failed attempt.
    const whileCorrecting = JSON.stringify(requests[1]);
    expect(whileCorrecting).toContain("was not found");

    // After the tool succeeds, they are gone: the model is not left re-reading
    // dead ends as though they still described the workspace.
    const afterSuccess = requests.at(-1) ?? [];
    expect(JSON.stringify(afterSuccess)).not.toContain("was not found");
    expect(
      afterSuccess.filter(
        (message) => message.role === "tool" && message.name === "multi_edit",
      ),
    ).toHaveLength(1);
    // No tool result is left pointing at a call the assistant no longer made.
    const announced = new Set(
      afterSuccess.flatMap((message) =>
        message.role === "assistant"
          ? (message.toolCalls ?? []).map((call) => call.id)
          : [],
      ),
    );
    for (const message of afterSuccess)
      if (message.role === "tool")
        expect(announced.has(message.toolCallId)).toBe(true);
  });

  it("shows the person a correctable failure once the model has run out of tries", async () => {
    const tool = selfCorrectingTool(99);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: repeatsOneCall("multi_edit", "I could not apply the edit.", 4),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");

    const actions = loop.snapshot().tasks[0]?.actions ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: "failed",
      reason: "“old text” was not found in notes.md.",
    });
  });

  it("gives the model its tries again after the tool succeeds", async () => {
    // Refused, refused, accepted, then refused three times and accepted: five
    // refusals in the turn, but never more than three in a row.
    const accepted = [3, 7];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: {
        list: () => [
          {
            name: "multi_edit",
            description: "Edit files.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async (_name, args): Promise<ToolCallInspection> =>
          accepted.includes(Number((args as { call?: number }).call))
            ? {
                ok: true,
                action: "Edit a workspace file",
                target: "notes.md",
                command: "multi_edit({})",
              }
            : {
                ok: false,
                reason: "“old text” was not found in notes.md.",
                correctable: true,
              },
        execute: async () => ({ ok: true as const, value: { edited: true } }),
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: repeatsOneCall("multi_edit", "Both edits are in place.", 7, true),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the two owner lines");

    const task = loop.snapshot().tasks[0];
    expect(task?.actions?.map((action) => action.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(JSON.stringify(task)).not.toContain("was not found");
  });

  it("never hides a refusal the tool did not mark correctable", async () => {
    const tool = selfCorrectingTool(1, false);
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      model: {
        ...deps.model,
        send: repeatsOneCall("multi_edit", "Done.", 1),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");

    const actions = loop.snapshot().tasks[0]?.actions ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ status: "failed" });
  });
});

/**
 * An edit tool that accepts an edit only when it is aimed at the text the
 * file holds, "Owner: Rowan", and refuses every other as correctable; and a
 * loop whose model makes the given calls to it in turn, then stops.
 */
function editLoop(
  calls: readonly string[],
  corrections: FakeCorrectionsLog = fakeCorrectionsLog(),
) {
  const seen: unknown[] = [];
  const deps = stubDependencies(() => {});
  let turn = 0;
  const loop = loopFrom({
    ...deps,
    corrections,
    tools: {
      list: () => [
        {
          name: "multi_edit",
          description: "Replace exact text in workspace files.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (
        _name: string,
        args: unknown,
      ): Promise<ToolCallInspection> => {
        seen.push(args);
        const find = (args as { find?: string }).find;
        return find === "Owner: Rowan"
          ? {
              ok: true,
              action: "Edit a workspace file",
              target: "notes.md",
              command: "multi_edit({})",
            }
          : {
              ok: false,
              correctable: true,
              reason: `“${find}” was not found in notes.md.`,
            };
      },
      execute: async () => ({ ok: true as const, value: { edited: true } }),
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    model: {
      ...deps.model,
      send: async function* () {
        const args = calls[turn];
        turn += 1;
        if (args)
          yield {
            kind: "toolCallDelta" as const,
            index: 0,
            callId: `call-${turn}`,
            name: "multi_edit",
            argumentsDelta: args,
          };
        else yield { kind: "textDelta" as const, text: "Done." };
        yield { kind: "done" as const };
      },
    },
  });
  return { loop, seen, corrections };
}

/**
 * A conversation whose model follows `script`, one step per request: an edit
 * sent `{"wrong": true}` is refused as correctable, any other call succeeds.
 */
function scriptedLoop(
  script: (
    request: number,
  ) =>
    | { readonly call: string; readonly args?: object }
    | { readonly text: string },
) {
  const requests: ModelRequest[] = [];
  const deps = stubDependencies(() => {});
  const loop = loopFrom({
    ...deps,
    tools: {
      list: () =>
        ["multi_edit", "read_file"].map((name) => ({
          name,
          description: name,
          inputSchema: { type: "object" },
        })),
      inspect: async (
        name: string,
        args: unknown,
      ): Promise<ToolCallInspection> =>
        (args as { wrong?: boolean }).wrong
          ? {
              ok: false,
              reason: "“old text” was not found in notes.md.",
              correctable: true,
            }
          : {
              ok: true,
              action: name,
              target: "notes.md",
              command: `${name}({})`,
            },
      execute: async () => ({ ok: true as const, value: "Done." }),
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    model: {
      ...deps.model,
      send: async function* (request: ModelRequest) {
        requests.push(request);
        const step = script(requests.length);
        if ("text" in step)
          yield { kind: "textDelta" as const, text: step.text };
        else
          yield {
            kind: "toolCallDelta" as const,
            index: 0,
            callId: `call-${requests.length}`,
            name: step.call,
            argumentsDelta: JSON.stringify(step.args ?? {}),
          };
        yield { kind: "done" as const };
      },
    },
  });
  return { loop, requests };
}

describe("a quiet correction and the next turn", () => {
  it("is sent to the next turn as the turn sent it, while the tool has not yet succeeded", async () => {
    const { loop, requests } = scriptedLoop((request) =>
      request === 1
        ? { call: "multi_edit", args: { wrong: true } }
        : request === 2
          ? { call: "read_file" }
          : { text: request === 3 ? "The edit could not be made." : "Yes." },
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");
    await loop.start(taskId, "Is that all?");

    const lastOfTurn = requests[2]?.messages ?? [];
    const nextTurn = requests[3]?.messages ?? [];
    expect(JSON.stringify(lastOfTurn)).toContain("was not found");
    expect(sharedPrefix(lastOfTurn, nextTurn)).toBe(lastOfTurn.length);
  });

  it("is gone from the next turn too, once the tool succeeded and it was taken back", async () => {
    const { loop, requests } = scriptedLoop((request) =>
      request === 1
        ? { call: "multi_edit", args: { wrong: true } }
        : request === 2
          ? { call: "multi_edit" }
          : { text: request === 3 ? "The edit is in place." : "Yes." },
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Fix the owner line");
    await loop.start(taskId, "Is that all?");

    const lastOfTurn = requests[2]?.messages ?? [];
    const nextTurn = requests[3]?.messages ?? [];
    expect(JSON.stringify(nextTurn)).not.toContain("was not found");
    expect(sharedPrefix(lastOfTurn, nextTurn)).toBe(lastOfTurn.length);
  });
});

describe("the record of a quiet correction", () => {
  it("is kept in the corrections log, with the call as the model made it", async () => {
    const { loop, seen, corrections } = editLoop([
      '{"find":"Owner: Dana","replace":"Owner: Kim"}',
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    // Only the model's own call was looked at, and nothing reached the person.
    expect(seen).toEqual([{ find: "Owner: Dana", replace: "Owner: Kim" }]);
    expect(loop.snapshot().tasks[0]?.actions ?? []).toEqual([]);
    expect(corrections.entries).toEqual([
      expect.objectContaining({
        at: "2026-09-02T19:00:00.000Z",
        taskId,
        toolName: "multi_edit",
        kind: "quiet-retry",
        reason: "“Owner: Dana” was not found in notes.md.",
        inRow: 1,
      }),
    ]);
    expect(corrections.entries[0]?.before).toContain("Owner: Dana");
  });

  it("says how many of the tool's calls in a row were refused", async () => {
    // Wrong twice, right once, then wrong again.
    const { loop, corrections } = editLoop([
      '{"find":"Owner: Dana","replace":"Owner: Kim"}',
      '{"find":"Owner: Dan","replace":"Owner: Kim"}',
      '{"find":"Owner: Rowan","replace":"Owner: Kim"}',
      '{"find":"Owner: Dana","replace":"Owner: Kim"}',
    ]);

    await loop.start(await loop.createTask(), "Change the owner to Kim");

    expect(
      corrections.entries.map((entry) => [entry.kind, entry.inRow]),
    ).toEqual([
      ["quiet-retry", 1],
      ["quiet-retry", 2],
      ["quiet-retry", 1],
    ]);
  });

  it("keeps the turn going, and says so, when the corrections log cannot be written", async () => {
    const { loop } = editLoop(
      ['{"find":"Owner: Dana","replace":"Owner: Kim"}'],
      fakeCorrectionsLog({
        record: async () => {
          throw new Error("disk full");
        },
      }),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    // The turn is unharmed...
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
    // ...and the gap in the record is not hidden.
    expect(loop.snapshot().issues).toContain(
      "A correction to the agent's work could not be saved to the corrections log. Work continued; the log is incomplete.",
    );
  });
});
