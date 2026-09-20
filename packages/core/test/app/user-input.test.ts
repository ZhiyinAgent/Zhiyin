import { describe, expect, it, vi } from "vitest";
import type { ModelRequest, ModelToolCall } from "@zhiyin/model-client";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { WorkspaceTools } from "@zhiyin/tools";
import type { TestApp as AgentLoop } from "./support.js";
import { stubDependencies, until, loopFrom } from "./support.js";

const quizArguments = {
  title: "Release readiness",
  questions: [
    {
      id: "gate",
      prompt: "Which command runs the repository gate?",
      answers: [
        { id: "test", label: "pnpm test" },
        { id: "gate", label: "scripts/gate.ps1" },
      ],
      selection: "single",
      correctAnswerIds: ["gate"],
      explanation: "The gate includes every required repository check.",
    },
    {
      id: "evidence",
      prompt: "Which are product evidence?",
      answers: [
        { id: "unit", label: "Unit tests" },
        { id: "review", label: "Independent review" },
        { id: "installed", label: "Installed-app exercise" },
      ],
      selection: "multiple",
      correctAnswerIds: ["review", "installed"],
      explanation:
        "Independent and installed-app checks supply evidence beyond unit tests.",
    },
  ],
};

const clarificationArguments = {
  title: "Choose the release",
  questions: [
    {
      id: "audience",
      prompt: "Who should receive it first?",
      options: [
        { id: "team", label: "Internal team" },
        { id: "customers", label: "Customers" },
      ],
    },
  ],
};

function requesting(name: string, args: unknown, requests: ModelRequest[]) {
  let round = 0;
  return async function* (request: ModelRequest) {
    requests.push(request);
    round += 1;
    if (round === 1) {
      const call: ModelToolCall = {
        id: `${name}-1`,
        name,
        arguments: JSON.stringify(args),
      };
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: call.id,
        name: call.name,
        argumentsDelta: call.arguments,
      };
    } else {
      yield {
        kind: "textDelta" as const,
        text: "Thanks — I used your answer.",
      };
    }
    yield { kind: "done" as const };
  };
}

function pendingId(loop: AgentLoop, taskId: string): string {
  const phase = loop.snapshot().tasks.find((task) => task.id === taskId)?.phase;
  if (phase?.kind !== "input") throw new Error("No pending user input.");
  return phase.prompt.id;
}

describe("AgentLoop user input", () => {
  it("pauses for the exact quiz response and returns its score to the model", async () => {
    const base = stubDependencies(() => {});
    const requests: ModelRequest[] = [];
    const decide = vi.fn(base.permissions.decide);
    let saved: WorkspaceSnapshot | undefined;
    let inputNumber = 0;
    const loop = loopFrom({
      ...base,
      permissions: { decide },
      tools: new WorkspaceTools(undefined, { shell: undefined }),
      model: {
        ...base.model,
        send: requesting("render_quiz", quizArguments, requests),
      },
      sessions: {
        ...base.sessions,
        saveWorkspace: async (snapshot) => {
          saved = snapshot;
        },
      },
      newUserInputId: () => `input-${++inputNumber}`,
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Quiz me");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    expect(loop.snapshot().tasks[0]?.phase).toMatchObject({
      kind: "input",
      prompt: { id: "input-1", kind: "quiz", title: "Release readiness" },
    });
    await expect(
      loop.resolveUserInput(taskId, "stale", {
        answers: [],
      }),
    ).rejects.toThrow("no longer active");

    await loop.resolveUserInput(taskId, pendingId(loop, taskId), {
      answers: [
        { questionId: "gate", answerIds: ["gate"] },
        { questionId: "evidence", answerIds: ["installed", "review"] },
      ],
    });
    await running;

    expect(decide).not.toHaveBeenCalled();
    const toolResult = requests[1]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolResult?.content).toContain('"correct":2');
    const task = loop.snapshot().tasks[0];
    expect(task?.interactions).toEqual([
      expect.objectContaining({
        id: "interaction-render_quiz-1",
        callId: "render_quiz-1",
        request: expect.objectContaining({ kind: "quiz" }),
        response: expect.objectContaining({ answers: expect.any(Array) }),
      }),
    ]);
    expect(task?.messages.at(-2)).toMatchObject({
      role: "user",
      interactionId: "interaction-render_quiz-1",
    });
    expect(saved?.tasks[0]?.interactions).toHaveLength(1);
  });

  it("rejects an invalid clarification without consuming the request", async () => {
    const base = stubDependencies(() => {});
    const requests: ModelRequest[] = [];
    const loop = loopFrom({
      ...base,
      tools: new WorkspaceTools(undefined, { shell: undefined }),
      model: {
        ...base.model,
        send: requesting("ask_user", clarificationArguments, requests),
      },
      newUserInputId: () => "clarification-1",
    });
    const taskId = await loop.createTask();
    const running = loop.start(taskId, "Prepare a release");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");

    await expect(
      loop.resolveUserInput(taskId, "clarification-1", {
        answers: [{ questionId: "audience", answerIds: ["invented"] }],
      }),
    ).rejects.toThrow("Choose one offered answer");
    expect(pendingId(loop, taskId)).toBe("clarification-1");

    await loop.resolveUserInput(taskId, "clarification-1", {
      answers: [{ questionId: "audience", answerIds: ["team"] }],
    });
    await running;
    expect(
      requests[1]?.messages.find((message) => message.role === "tool")?.content,
    ).toContain("Internal team");
  });

  it("cancels a turn waiting for clarification without accepting a late answer", async () => {
    const base = stubDependencies(() => {});
    const loop = loopFrom({
      ...base,
      tools: new WorkspaceTools(undefined, { shell: undefined }),
      model: {
        ...base.model,
        send: requesting("ask_user", clarificationArguments, []),
      },
      newUserInputId: () => "clarification-1",
    });
    const taskId = await loop.createTask();
    const running = loop.start(taskId, "Prepare a release");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");

    await loop.cancel(taskId);
    await running;

    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("interrupted");
    expect(loop.snapshot().tasks[0]?.interactions ?? []).toEqual([]);
    await expect(
      loop.resolveUserInput(taskId, "clarification-1", {
        answers: [{ questionId: "audience", answerIds: ["team"] }],
      }),
    ).rejects.toThrow("no longer active");
  });
});
