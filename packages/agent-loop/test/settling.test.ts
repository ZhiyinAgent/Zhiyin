/** What the loop says about a turn that did not finish. */

import { describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { AgentLoop, type AgentLoopDependencies } from "../src/index.js";

// Settling reads a conversation and returns another; it reaches nothing.
const loop = new AgentLoop({} as AgentLoopDependencies);

const conversation = (task: Partial<WorkspaceTask>): WorkspaceTask =>
  ({
    id: "task-1",
    title: "A conversation",
    messages: [],
    ...emptyConversationLists,
    phase: { kind: "idle" },
    ...task,
  }) as WorkspaceTask;

describe("a turn that did not finish", () => {
  it("settles a turn the app closed on as interrupted", () => {
    const settled = loop.settleAfterRestart(
      conversation({
        phase: { kind: "working" },
        actions: [
          { id: "1", status: "running" },
          { id: "2", status: "completed" },
        ] as WorkspaceTask["actions"],
        messages: [
          { id: "m1", role: "assistant", reasoning: { status: "streaming" } },
        ] as unknown as WorkspaceTask["messages"],
      }),
    );

    expect(settled.phase).toEqual({
      kind: "interrupted",
      reason: "Zhiyin closed before this was finished.",
    });
    expect(settled.actions).toEqual([
      {
        id: "1",
        status: "cancelled",
        reason: "The app closed before this action completed.",
      },
      { id: "2", status: "completed" },
    ]);
    expect(settled.messages[0]?.reasoning?.status).toBe("interrupted");
  });

  it("leaves a conversation with nothing unfinished exactly as it was", () => {
    const finished = conversation({
      phase: { kind: "completed" },
      actions: [{ id: "1", status: "completed" }] as WorkspaceTask["actions"],
    });

    expect(loop.settleAfterRestart(finished)).toBe(finished);
  });

  it("restores unfinished specialist work as interrupted", () => {
    const settled = loop.settleAfterRestart(
      conversation({
        phase: { kind: "working", steps: [] },
        specialistRuns: [
          {
            id: "specialist-1",
            specialist: {
              id: "software-engineering/code-reviewer",
              name: "Code reviewer",
              description: "Reviews changes.",
              instructions: "Review behavior and regressions.",
              provenance: {
                source: "plugin",
                pluginId: "software-engineering",
              },
            },
            task: "Review the change.",
            depth: 1,
            status: "running",
            startedAt: "2026-09-16T18:00:00.000Z",
            actionIds: [],
          },
        ],
      }),
    );

    expect(settled.specialistRuns).toMatchObject([
      {
        id: "specialist-1",
        status: "interrupted",
        finishedAt: expect.any(String),
        reason: "The app closed before this specialist completed.",
      },
    ]);
  });

  it("settles reasoning that was still arriving when the turn ended", () => {
    const streaming = [
      { id: "m1", role: "assistant", reasoning: { status: "streaming" } },
    ] as unknown as WorkspaceTask["messages"];

    expect(
      loop.settleEndedTurn(
        conversation({ phase: { kind: "completed" }, messages: streaming }),
      ).messages[0]?.reasoning?.status,
    ).toBe("complete");
    expect(
      loop.settleEndedTurn(
        conversation({ phase: { kind: "failed" }, messages: streaming }),
      ).messages[0]?.reasoning?.status,
    ).toBe("interrupted");
    const running = conversation({
      phase: { kind: "working" },
      messages: streaming,
    });
    expect(loop.settleEndedTurn(running)).toBe(running);
  });
});

describe("a command still running as a job when the app closed", () => {
  it("is told to the model at its next request, as Zhiyin, and the record of it goes", () => {
    const settled = loop.settleAfterRestart(
      conversation({
        phase: { kind: "completed" } as WorkspaceTask["phase"],
        runningJobs: [{ id: "J1", command: "npm run build" }],
        modelHistory: [{ id: "e1", kind: "notice", content: "earlier" }],
      }),
    );

    expect(settled.runningJobs).toEqual([]);
    expect(settled.modelHistory?.slice(0, 1)).toEqual([
      { id: "e1", kind: "notice", content: "earlier" },
    ]);
    expect(settled.modelHistory?.slice(1)).toEqual([
      {
        id: expect.any(String),
        kind: "notice",
        content:
          '<zhiyin-notice kind="job">The command npm run build, running as a job, was stopped when Zhiyin closed. What it printed is no longer available, and what it had already done stays done.</zhiyin-notice>',
      },
    ]);
  });
});
