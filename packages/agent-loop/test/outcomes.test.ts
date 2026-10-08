import { describe, expect, it } from "vitest";
import type {
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import {
  ModelClientError,
  OpenRouterModelClient,
  type ModelRequest,
} from "@zhiyin/model-client";
import { stubDependencies, loopFrom } from "./support.js";

function toolReturning(result: ToolInvocationResult) {
  return {
    list: () => [
      {
        name: "bash",
        description: "Run one bash command.",
        inputSchema: { type: "object" },
      },
    ],
    inspect: async (): Promise<ToolCallInspection> => ({
      ok: true,
      action: "Run a command",
      target: "command -v python3",
      command: 'bash({"command":"command -v python3"})',
    }),
    execute: async () => result,
  };
}

function callsOnce(name: string) {
  let turn = 0;
  return async function* (request: ModelRequest) {
    turn += 1;
    if (turn === 1) {
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: "call-1",
        name,
        argumentsDelta: "{}",
      };
    } else {
      yield { kind: "textDelta" as const, text: "Python 3 is not installed." };
    }
    void request;
    yield { kind: "done" as const };
  };
}

async function runOnce(result: ToolInvocationResult) {
  const deps = stubDependencies(() => {});
  const loop = loopFrom({
    ...deps,
    tools: toolReturning(result),
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    model: { ...deps.model, send: callsOnce("bash") },
  });
  const taskId = await loop.createTask();
  await loop.start(taskId, "Check whether Python is available");
  return loop.snapshot().tasks[0];
}

describe("AgentLoop action outcomes", () => {
  /**
   * `command -v python3` exiting 1 answers the question that was asked. Shown
   * as a failure it reads as the app having broken, which is both untrue and
   * the opposite of what the person should take from it.
   */
  it("shows an action that ran and answered as reported, not failed", async () => {
    const task = await runOnce({
      ok: false,
      reported: true,
      reason: "The command exited with code 1.",
      value: { exitCode: 1, stdout: "", stderr: "" },
    });

    expect(task?.actions?.map((action) => action.status)).toEqual(["reported"]);
    // The evidence survives either way; only the marker differs.
    expect(task?.actions?.[0]?.reason).toBe("The command exited with code 1.");
  });

  it("still shows an action that could not run at all as failed", async () => {
    const task = await runOnce({
      ok: false,
      reason: "The command could not be started. Check that the shell exists.",
    });

    expect(task?.actions?.map((action) => action.status)).toEqual(["failed"]);
  });

  it("shows an action that succeeded as completed", async () => {
    const task = await runOnce({ ok: true, value: { exitCode: 0 } });

    expect(task?.actions?.map((action) => action.status)).toEqual([
      "completed",
    ]);
  });
});

/**
 * Reviewing a change before approving it and checking afterwards what was done
 * are the same question. The record has to keep the answer, or the second
 * asking gets a summary written after the fact.
 */
describe("AgentLoop action evidence", () => {
  async function runWith(
    inspection: Partial<ToolCallInspection & { ok: true }>,
    result: ToolInvocationResult,
  ) {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: {
        list: () => [
          {
            name: "write_file",
            description: "Write a file.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async (): Promise<ToolCallInspection> => ({
          ok: true,
          action: "Overwrite an existing workspace file",
          target: "brief.md",
          command: 'write_file({"path":"brief.md"})',
          ...inspection,
        }),
        execute: async () => result,
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Fine" }),
      },
      model: { ...deps.model, send: callsOnce("write_file") },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Rewrite the brief");
    return loop.snapshot().tasks[0]?.actions?.[0];
  }

  it("keeps the change an action proposed on the record of it happening", async () => {
    const action = await runWith(
      {
        changes: [
          {
            path: "brief.md",
            change: "updated",
            before: "Old.",
            after: "New.",
          },
        ],
      },
      { ok: true, value: {} },
    );

    expect(action?.changes).toEqual([
      { path: "brief.md", change: "updated", before: "Old.", after: "New." },
    ]);
  });

  it("keeps which files were copied before the change, and why one was not", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      workspace: { ...deps.workspace, workspaceRoot: () => "C:/work" },
      recovery: {
        ...deps.recovery,
        prepare: async (actionId, _root, changes) => ({
          actionId,
          files: changes.map((change) =>
            change.path === "big.csv"
              ? {
                  path: change.path,
                  status: "unprotected" as const,
                  reason: "Too large to keep a copy.",
                }
              : { path: change.path, status: "protected" as const },
          ),
        }),
      },
      tools: {
        list: () => [
          {
            name: "write_file",
            description: "Write a file.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async (): Promise<ToolCallInspection> => ({
          ok: true,
          action: "Write two files",
          target: "brief.md",
          command: "write_file({})",
          access: "change",
          scope: "workspace",
          changes: [
            { path: "brief.md", change: "updated", before: "a", after: "b" },
            { path: "big.csv", change: "updated" },
          ],
        }),
        execute: async () => ({ ok: true, value: {} }),
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Fine" }),
      },
      model: { ...deps.model, send: callsOnce("write_file") },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Rewrite both");

    expect(loop.snapshot().tasks[0]?.actions?.[0]?.recovery).toEqual({
      files: [
        { path: "brief.md", status: "protected" },
        {
          path: "big.csv",
          status: "unprotected",
          reason: "Too large to keep a copy.",
        },
      ],
    });
  });

  it("keeps what the tool reported, in the shapes the tool named", async () => {
    const action = await runWith(
      {},
      {
        ok: true,
        value: {},
        details: [
          { kind: "facts", items: [{ label: "Size", value: "4 bytes" }] },
        ],
      },
    );

    expect(action?.details).toEqual([
      { kind: "facts", items: [{ label: "Size", value: "4 bytes" }] },
    ]);
  });

  it("keeps what a person was told when they allowed it", async () => {
    const action = await runWith(
      {
        detail: "This replaces the current contents of brief.md.",
        claim: "Rewrite the brief with the agreed wording.",
      },
      { ok: true, value: {} },
    );

    expect(action?.detail).toBe(
      "This replaces the current contents of brief.md.",
    );
    expect(action?.claim).toBe("Rewrite the brief with the agreed wording.");
  });

  it("records nothing of its own for a tool that described nothing", async () => {
    const action = await runWith({}, { ok: true, value: { anything: true } });

    expect(action?.details).toBeUndefined();
    expect(action?.changes).toBeUndefined();
    // The raw record is still there; it is the fallback, not the headline.
    expect(action?.evidence).toContain("anything");
  });
});

/**
 * The provider's headers commit HTTP 200 before anything goes wrong, so a
 * failure after that arrives inside the stream. The turn must end failed and
 * say why, rather than keeping the half an answer that arrived and calling it
 * complete.
 */
describe("AgentLoop when the provider fails mid-answer", () => {
  it("ends the turn failed and says what the provider said", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* () {
          yield { kind: "textDelta" as const, text: "The three largest are" };
          throw new ModelClientError(
            "rateLimited",
            "Rate limit exceeded for Z.AI",
          );
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Which are the largest?");

    expect(loop.snapshot().tasks[0]?.phase).toEqual({
      kind: "failed",
      reason: "Rate limit exceeded for Z.AI",
      remedies: ["tryAgain"],
    });
  });

  /**
   * A 400 that is not about size must not end the turn with "too large",
   * sending somebody to start a new conversation over a bad tool schema. The
   * provider's own sentence is the useful part.
   */
  it("shows the provider's reason for a refused request that is not about size", async () => {
    const deps = stubDependencies(() => {});
    const client = new OpenRouterModelClient({
      apiKey: async () => "key",
      model: "z-ai/glm-5.3-flash",
      fetcher: async () => ({
        ok: false,
        status: 400,
        headers: { get: () => null },
        body: (async function* () {
          yield new TextEncoder().encode(
            JSON.stringify({
              error: {
                code: 400,
                message: "Invalid schema for function 'write_file'",
                metadata: { error_type: "invalid_request" },
              },
            }),
          );
        })(),
      }),
    });
    const loop = loopFrom({
      ...deps,
      model: { ...deps.model, send: (request) => client.send(request) },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write the summary.");

    const phase = loop.snapshot().tasks[0]?.phase;
    expect(phase).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("Invalid schema for function"),
    });
    expect(JSON.stringify(phase)).not.toMatch(/too large/i);
  });

  it("keeps the part of the answer that did arrive", async () => {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* () {
          yield { kind: "textDelta" as const, text: "The three largest are" };
          throw new ModelClientError("rateLimited", "Rate limit exceeded");
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Which are the largest?");

    expect(
      loop
        .snapshot()
        .tasks[0]!.messages.map((message) => message.text)
        .join(" "),
    ).toContain("The three largest are");
  });
});

/**
 * A failed turn records what the person can do about it, so the window can
 * offer it as a button and still offer it after a restart. The steps follow
 * the model client's account of the failure, never the wording of its message.
 */
describe("AgentLoop: what a failed turn offers next", () => {
  async function failedWith(error: Error) {
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      model: {
        ...deps.model,
        send: async function* () {
          if (error) throw error;
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Summarise the notes.");
    return loop.snapshot().tasks[0]?.phase;
  }

  it.each([
    ["noModel", ["chooseModel"]],
    ["missingCredential", ["updateApiKey"]],
    ["unauthorized", ["updateApiKey"]],
    ["credentialUnavailable", ["openSettings"]],
    ["rateLimited", ["tryAgain"]],
    ["networkFailure", ["tryAgain"]],
    ["malformedResponse", ["tryAgain"]],
    ["requestRejected", ["tryAgain"]],
    ["unexplainedError", ["tryAgain"]],
    ["modelUnavailable", ["chooseModel", "tryAgain"]],
    ["unsupportedReasoning", ["chooseModel", "tryAgain"]],
    ["outOfCredits", ["addCredits", "tryAgain"]],
    ["attachmentRejected", ["editMessage"]],
    ["refused", []],
  ] as const)("offers %s the step that fixes it", async (code, remedies) => {
    const phase = await failedWith(new ModelClientError(code, "It failed."));

    if (phase?.kind !== "failed") throw new Error("The turn did not fail.");
    expect(phase.remedies ?? []).toEqual(remedies);
  });

  it("offers to continue from completed work, as well as to start again, when the connection drops after an action", async () => {
    const deps = stubDependencies(() => {});
    let requests = 0;
    const loop = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Allowed." }),
      },
      tools: toolReturning({ ok: true, value: "/usr/bin/python3" }),
      model: {
        ...deps.model,
        send: async function* () {
          requests += 1;
          if (requests === 1) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "check",
              name: "bash",
              argumentsDelta: '{"command":"command -v python3"}',
            };
            yield { kind: "done" as const };
          } else {
            throw new ModelClientError("networkFailure", "Connection reset");
          }
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Check for Python, then report.");

    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "failed",
      remedies: ["continue", "tryAgain"],
    });
  });

  it("offers nothing for a failure that is not the model's", async () => {
    const phase = await failedWith(new Error("The disk is full."));

    expect(phase).toEqual({
      kind: "failed",
      reason: "The model request failed. Try again.",
    });
  });
});
