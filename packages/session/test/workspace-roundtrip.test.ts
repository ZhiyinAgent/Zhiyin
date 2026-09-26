import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot, WorkspaceTask } from "@zhiyin/contract";
import { FileSessions, SessionStoreError } from "../src/index.js";
import {
  plantHistory,
  plantUnreadableHistory,
  savedSettings,
  savedText,
} from "./planted-history.js";

const roots: string[] = [];

describe("saved reasoning", () => {
  it("restores reasoning and the conversation's selected effort", async () => {
    const root = await temporaryRoot();
    const task = {
      ...snapshot.tasks[0]!,
      reasoning: { enabled: true as const, effort: "high" as const },
      messages: [
        {
          id: "answer",
          role: "assistant" as const,
          text: "Answer",
          reasoning: { text: "Compared sources.", status: "complete" as const },
        },
      ],
      compaction: undefined,
    };
    const saved = { ...snapshot, tasks: [task] };
    await new FileSessions(root).saveWorkspace(saved);
    expect(
      (await new FileSessions(root).loadWorkspace())?.tasks[0],
    ).toMatchObject({ reasoning: task.reasoning, messages: task.messages });
  });

  it("restores the provider evidence for each model response", async () => {
    const root = await temporaryRoot();
    const task = {
      ...snapshot.tasks[0]!,
      modelResponses: [
        {
          requestId: "gen-incomplete",
          model: "z-ai/glm-5.3-flash-20260826",
          provider: "Z.AI",
          finishReason: null,
          termination: "sentinel" as const,
          complete: false,
        },
      ],
    };
    await new FileSessions(root).saveWorkspace({ ...snapshot, tasks: [task] });

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      {
        tasks: [{ modelResponses: task.modelResponses }],
      },
    );
  });

  it("restores the failed attempts recorded before a model response", async () => {
    const root = await temporaryRoot();
    const task = {
      ...snapshot.tasks[0]!,
      modelResponses: [
        {
          finishReason: "stop",
          termination: "finishReason" as const,
          complete: true,
          retries: [
            { failure: "rateLimited", delayMs: 1_000, kind: "silent" as const },
            {
              failure: "networkFailure",
              delayMs: 2_000,
              kind: "restart" as const,
              discardedCharacters: 120,
            },
          ],
        },
      ],
    };
    await new FileSessions(root).saveWorkspace({ ...snapshot, tasks: [task] });

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      { tasks: [{ modelResponses: task.modelResponses }] },
    );
  });

  it("rejects malformed retry evidence without losing the saved file", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          modelResponses: [
            {
              finishReason: "stop",
              termination: "finishReason",
              complete: true,
              retries: [{ failure: "rateLimited", delayMs: "soon" }],
            },
          ],
        },
      ],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toMatchObject({
      code: "corrupted",
    });
  });

  it("rejects malformed provider evidence without losing the saved file", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          modelResponses: [
            {
              requestId: "gen-incomplete",
              finishReason: 42,
              termination: "invented",
              complete: "perhaps",
            },
          ],
        },
      ],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toMatchObject({
      code: "corrupted",
    });
  });

  it("rejects malformed reasoning records without losing the saved file", async () => {
    const root = await temporaryRoot();
    for (const reasoning of [
      { text: 42, status: "complete" },
      { text: "Thought", status: "invented" },
    ]) {
      await plantHistory(root, {
        ...snapshot,
        tasks: [
          {
            ...snapshot.tasks[0],
            compaction: undefined,
            messages: [{ id: "a", role: "assistant", text: "", reasoning }],
          },
        ],
      });
      await expect(
        new FileSessions(root).loadWorkspace(),
      ).rejects.toMatchObject({ code: "corrupted" });
    }
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-session-test-"));
  roots.push(root);
  return root;
}

const snapshot: WorkspaceSnapshot = {
  runtime: { tasks: "available", capabilities: "unavailable" },
  selectedTaskId: "task-1",
  tasks: [
    {
      id: "task-1",
      title: "Introduce yourself",
      titleSource: "generated",
      updatedAt: "2026-09-04T20:00:00.000Z",
      updatedLabel: "Now",
      messages: [
        {
          id: "message-1",
          role: "user",
          text: "Introduce yourself",
          sequence: 0,
        },
        {
          id: "message-2",
          role: "assistant",
          text: "Hello.",
          sequence: 2,
        },
      ],
      actions: [
        {
          id: "read-package",
          action: "Read package.json",
          description: "Identify the project and package manager.",
          target: "package.json",
          sequence: 1,
          status: "completed",
          evidence: "The package is named Zhiyin.",
        },
      ],
      specialistRuns: [
        {
          id: "specialist-1",
          specialist: {
            id: "software-engineering/code-reviewer",
            name: "Code reviewer",
            description: "Reviews a change.",
            instructions: "Review behavior and regressions.",
            provenance: {
              source: "plugin",
              pluginId: "software-engineering",
            },
          },
          task: "Review the package change.",
          depth: 1,
          status: "completed",
          startedAt: "2026-09-04T20:00:00.000Z",
          finishedAt: "2026-09-04T20:01:00.000Z",
          actionIds: ["read-package"],
          handoff: {
            summary: "The package is coherent.",
            findings: ["The behavior has coverage."],
            recommendations: ["Keep the regression test."],
            limitations: [],
          },
        },
      ],
      compaction: {
        revision: 1,
        throughMessageId: "message-1",
        summary: "The person asked for an introduction.",
        retainedActionIds: ["read-package"],
        createdAt: "2026-09-04T19:59:00.000Z",
      },
      plan: [
        {
          id: "plan-1",
          title: "Identify the project",
          criterion: "The answer names the project from workspace evidence.",
          status: "verified",
          verification: "package.json names Zhiyin.",
        },
      ],
      views: [
        {
          id: "view-1",
          callId: "diagram-1",
          title: "Release flow",
          kind: "diagram",
          source: "flowchart LR\nDraft --> Review",
          sequence: 3,
        },
      ],
      phase: {
        kind: "completed",
        outcome: { title: "Response complete", summary: "Hello." },
      },
    },
  ],
  mcpServers: [
    {
      id: "docs",
      name: "Project docs",
      url: "https://docs.example.com/mcp",
      enabled: true,
      status: "connected",
      toolCount: 4,
    },
  ],
  usage: { status: "unavailable", reason: "No usage recorded." },
};

/**
 * The shared fixture keeps a compaction that names one retained action, so a
 * test replacing the actions has to drop it or it is asserting against a
 * conversation that refers to work it no longer holds.
 */
function taskWithActions(actions: WorkspaceTask["actions"]): WorkspaceSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      compaction: undefined,
      actions,
    })),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FileSessions workspace persistence", () => {
  it("commits overlapping snapshots in submission order", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        sessions.saveWorkspace({
          ...snapshot,
          selectedTaskId: null,
          tasks: snapshot.tasks.map((task) => ({
            ...task,
            title: `Revision ${index}`,
          })),
        }),
      ),
    );
    expect((await sessions.loadWorkspace())?.tasks[0]?.title).toBe(
      "Revision 11",
    );
  });

  it("rejects malformed nested task state", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          messages: [null],
          phase: { kind: "invented" },
        },
      ],
    });
    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("rejects malformed specialist provenance and handoff state", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          specialistRuns: [
            {
              id: "specialist-1",
              specialist: {
                id: "reviewer",
                name: "Reviewer",
                description: "Reviews work.",
                instructions: "Review it.",
                provenance: { source: "plugin" },
              },
              task: "Review it.",
              depth: "one",
              status: "completed",
              startedAt: "not-a-date",
            },
          ],
        },
      ],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("rejects malformed durable view source at the persistence boundary", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        { ...snapshot.tasks[0], views: [{ id: "view-1", kind: "diagram" }] },
      ],
    });
    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("rejects a compaction checkpoint that cannot map back to durable history", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          compaction: {
            ...snapshot.tasks[0]?.compaction,
            throughMessageId: "missing-message",
          },
        },
      ],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("keeps the default budget, a conversation's own budget and last measured size, and what a condensing carried, across a restart", async () => {
    const root = await temporaryRoot();
    const task: WorkspaceTask = {
      ...snapshot.tasks[0]!,
      contextBudget: "ultra",
      contextUsage: {
        model: "wide",
        totalTokens: 40_000,
        measured: true,
        parts: {
          instructions: 1_000,
          tools: 4_000,
          summary: 500,
          conversation: 30_000,
          toolResults: 4_500,
        },
      },
      compaction: {
        ...snapshot.tasks[0]!.compaction!,
        throughEntryId: "entry-1",
        carried: "The person's latest request, in full:\nIntroduce it.",
      },
    };
    await new FileSessions(root).saveWorkspace({
      ...snapshot,
      contextBudget: "low",
      tasks: [task],
    });

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      {
        contextBudget: "low",
        tasks: [
          {
            contextBudget: "ultra",
            contextUsage: task.contextUsage,
            compaction: task.compaction,
          },
        ],
      },
    );
  });
  it("keeps each attempt to condense a conversation, failed or not, across a restart", async () => {
    const root = await temporaryRoot();
    const task: WorkspaceTask = {
      ...snapshot.tasks[0]!,
      condensings: [
        {
          id: "condensing-1",
          sequence: 4,
          createdAt: "2026-09-24T10:00:00.000Z",
          targetTokens: 13_600,
          tokensBefore: 14_200,
          outcome: "failed",
          reason: "request-failed",
          detail: "The provider is overloaded.",
        },
        {
          id: "condensing-2",
          sequence: 9,
          createdAt: "2026-09-24T10:05:00.000Z",
          targetTokens: 13_600,
          tokensBefore: 15_800,
          outcome: "condensed",
          revision: 1,
          throughMessageId: "message-1",
          tokensAfter: 4_100,
          messages: 12,
          actions: 30,
          summary: "## Goal\n\nIntroduce the project.",
          carried: "The person's latest request, in full:\nIntroduce it.",
          reread: ["package.json"],
        },
      ],
    };
    await new FileSessions(root).saveWorkspace({ ...snapshot, tasks: [task] });

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      { tasks: [{ condensings: task.condensings }] },
    );
  });
  it("rejects a condensing record with a reason Zhiyin never gives", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          condensings: [
            {
              id: "condensing-1",
              sequence: 4,
              createdAt: "2026-09-24T10:00:00.000Z",
              targetTokens: 13_600,
              tokensBefore: 14_200,
              outcome: "failed",
              reason: "it felt like it",
            },
          ],
        },
      ],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("keeps that a condensing followed a refusal as too long, and rejects any other mark", async () => {
    const record = {
      id: "condensing-1",
      sequence: 4,
      createdAt: "2026-09-24T10:00:00.000Z",
      targetTokens: 13_600,
      tokensBefore: 14_200,
      outcome: "failed" as const,
      reason: "nothing-to-condense" as const,
      afterRefusal: true as const,
    };
    const kept = await temporaryRoot();
    await new FileSessions(kept).saveWorkspace({
      ...snapshot,
      tasks: [{ ...snapshot.tasks[0]!, condensings: [record] }],
    });
    await expect(new FileSessions(kept).loadWorkspace()).resolves.toMatchObject(
      { tasks: [{ condensings: [record] }] },
    );

    const marked = await temporaryRoot();
    await plantHistory(marked, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          condensings: [{ ...record, afterRefusal: "yes" }],
        },
      ],
    });
    await expect(
      new FileSessions(marked).loadWorkspace(),
    ).rejects.toBeInstanceOf(SessionStoreError);
  });
  it("keeps the working model's progress on a plan apart from its verdict, and rejects progress it cannot have", async () => {
    const plan = [
      {
        id: "plan-1",
        title: "List the reports",
        criterion: "The reports folder was listed.",
        status: "pending" as const,
        progress: "done" as const,
        evidence: [{ callId: "call-1", shows: "It names q1.pdf." }],
        steps: [{ text: "List the folder", done: true }],
      },
      {
        id: "plan-2",
        title: "Check the totals",
        criterion: "The totals match the CSV.",
        status: "pending" as const,
        progress: "cancelled" as const,
        progressNote: "The person asked for no check.",
        addedBy: "assistant" as const,
      },
    ];
    const action = { ...snapshot.tasks[0]!.actions![0]!, planItemId: "plan-1" };
    const kept = await temporaryRoot();
    await new FileSessions(kept).saveWorkspace({
      ...snapshot,
      tasks: [{ ...snapshot.tasks[0]!, plan, actions: [action] }],
    });
    await expect(new FileSessions(kept).loadWorkspace()).resolves.toMatchObject(
      { tasks: [{ plan, actions: [action] }] },
    );

    for (const wrong of [
      { ...plan[0], progress: "finished" },
      { ...plan[0], evidence: [{ callId: "call-1" }] },
      { ...plan[0], steps: [{ text: "List", done: "yes" }] },
      { ...plan[1], addedBy: "planner" },
    ]) {
      const root = await temporaryRoot();
      await plantHistory(root, {
        ...snapshot,
        tasks: [{ ...snapshot.tasks[0], plan: [wrong] }],
      });
      await expect(
        new FileSessions(root).loadWorkspace(),
      ).rejects.toBeInstanceOf(SessionStoreError);
    }
  });

  it("keeps each of the judge's three verdicts and the calls one relied on", async () => {
    const plan = [
      {
        id: "plan-1",
        title: "List the reports",
        criterion: "The reports folder was listed.",
        status: "verified" as const,
        verification: "The listing names q1.pdf.",
        verdictEvidence: ["call-1"],
      },
      {
        id: "plan-2",
        title: "Check the totals",
        criterion: "The totals match the CSV.",
        status: "needs-attention" as const,
        verification: "No call compared the totals with the CSV.",
      },
      {
        id: "plan-3",
        title: "Write the summary",
        criterion: "summary.md names every report.",
        status: "couldnt-judge" as const,
        verification: "The provider is unreachable.",
      },
    ];
    const kept = await temporaryRoot();
    await new FileSessions(kept).saveWorkspace({
      ...snapshot,
      tasks: [{ ...snapshot.tasks[0]!, plan }],
    });
    await expect(new FileSessions(kept).loadWorkspace()).resolves.toMatchObject(
      { tasks: [{ plan }] },
    );

    for (const wrong of [
      { ...plan[0], status: "judged" },
      { ...plan[0], verdictEvidence: "call-1" },
      { ...plan[0], verdictEvidence: [1] },
    ]) {
      const root = await temporaryRoot();
      await plantHistory(root, {
        ...snapshot,
        tasks: [{ ...snapshot.tasks[0], plan: [wrong] }],
      });
      await expect(
        new FileSessions(root).loadWorkspace(),
      ).rejects.toBeInstanceOf(SessionStoreError);
    }
  });

  it("rejects a budget Zhiyin does not offer", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [{ ...snapshot.tasks[0], contextBudget: "enormous" }],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("rejects a compaction checkpoint that names unavailable evidence", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          compaction: {
            ...snapshot.tasks[0]?.compaction,
            retainedActionIds: ["missing-action"],
          },
        },
      ],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("restores the same conversations and choices in a new process instance", async () => {
    const root = await temporaryRoot();
    await new FileSessions(root).saveWorkspace(snapshot);

    const restored = await new FileSessions(root).loadWorkspace();

    expect(restored).toEqual({
      tasks: snapshot.tasks,
      selectedTaskId: snapshot.selectedTaskId,
    });
  });

  it("persists the exact renewable work-budget prompt", async () => {
    const root = await temporaryRoot();
    const waiting: WorkspaceSnapshot = {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({
        ...task,
        phase: {
          kind: "input" as const,
          steps: [],
          prompt: {
            id: "budget-1",
            kind: "workBudget" as const,
            title: "Continue working?",
            completedRounds: 24,
          },
        },
      })),
    };
    await new FileSessions(root).saveWorkspace(waiting);

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      {
        tasks: [
          {
            phase: {
              kind: "input",
              prompt: { id: "budget-1", kind: "workBudget" },
            },
          },
        ],
      },
    );
  });

  it("keeps why the work-budget question was asked, and rejects a reason that is not text", async () => {
    const waiting = (reason: unknown) => ({
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({
        ...task,
        phase: {
          kind: "input" as const,
          steps: [],
          prompt: {
            id: "budget-1",
            kind: "workBudget" as const,
            title: "Continue working?",
            completedRounds: 24,
            reason,
          },
        },
      })),
    });
    const reason =
      "The assistant repeated the same list_directory call 4 times.";
    const kept = await temporaryRoot();
    await new FileSessions(kept).saveWorkspace(
      waiting(reason) as WorkspaceSnapshot,
    );
    await expect(new FileSessions(kept).loadWorkspace()).resolves.toMatchObject(
      { tasks: [{ phase: { prompt: { reason } } }] },
    );

    const wrong = await temporaryRoot();
    await plantHistory(wrong, waiting(4));
    await expect(
      new FileSessions(wrong).loadWorkspace(),
    ).rejects.toBeInstanceOf(SessionStoreError);
  });

  it("persists a submitted quiz as one ordered conversation result", async () => {
    const root = await temporaryRoot();
    const withQuiz: WorkspaceSnapshot = {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({
        ...task,
        messages: [
          ...task.messages,
          {
            id: "interaction-quiz-answer",
            role: "user" as const,
            text: "Structured user response: scored quiz",
            interactionId: "interaction-quiz",
            sequence: 5,
          },
        ],
        interactions: [
          {
            id: "interaction-quiz",
            callId: "quiz-call",
            sequence: 4,
            request: {
              kind: "quiz",
              title: "Release readiness",
              questions: [
                {
                  id: "gate",
                  prompt: "Which command runs the gate?",
                  answers: [
                    { id: "test", label: "pnpm test" },
                    { id: "gate", label: "scripts/gate.ps1" },
                  ],
                  selection: "single",
                  correctAnswerIds: ["gate"],
                  explanation: "The gate includes every required check.",
                },
              ],
            },
            response: {
              answers: [{ questionId: "gate", answerIds: ["gate"] }],
            },
          },
        ],
      })),
    };
    await new FileSessions(root).saveWorkspace(withQuiz);

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      {
        tasks: [
          {
            interactions: [
              {
                id: "interaction-quiz",
                request: { kind: "quiz" },
                response: { answers: [{ answerIds: ["gate"] }] },
              },
            ],
          },
        ],
      },
    );
  });

  it("rejects a damaged stored interaction before it reaches the renderer", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          interactions: [
            {
              id: "interaction-quiz",
              callId: "quiz-call",
              request: { kind: "quiz", title: "Broken", questions: [] },
              response: { answers: [] },
            },
          ],
        },
      ],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });

  it("returns no workspace on a clean first launch", async () => {
    const root = await temporaryRoot();

    await expect(
      new FileSessions(root).loadWorkspace(),
    ).resolves.toBeUndefined();
  });

  it("replaces an earlier snapshot with the latest committed state", async () => {
    const root = await temporaryRoot();
    const sessions = new FileSessions(root);
    await sessions.saveWorkspace(snapshot);
    await sessions.saveWorkspace({
      ...snapshot,
      selectedTaskId: null,
      tasks: [],
    });

    await expect(sessions.loadWorkspace()).resolves.toMatchObject({
      selectedTaskId: null,
      tasks: [],
    });
  });

  it("reports corrupted local state instead of presenting it as an empty history", async () => {
    const root = await temporaryRoot();
    await plantUnreadableHistory(root);

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });

  it("restores the folders worked in before", async () => {
    const root = await temporaryRoot();
    const withFolders: WorkspaceSnapshot = {
      ...snapshot,
      workspace: { path: "C:/work/reports", name: "reports" },
      recentWorkspaces: [
        { path: "C:/work/reports", name: "reports" },
        { path: "C:/work/notes", name: "notes" },
      ],
    };
    await new FileSessions(root).saveWorkspace(withFolders);

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      {
        recentWorkspaces: [
          { path: "C:/work/reports", name: "reports" },
          { path: "C:/work/notes", name: "notes" },
        ],
      },
    );
  });

  it("restores the folder each conversation was last worked in", async () => {
    const root = await temporaryRoot();
    const perTask: WorkspaceSnapshot = {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({
        ...task,
        workspace: { path: "C:/work/notes", name: "notes" },
      })),
    };
    await new FileSessions(root).saveWorkspace(perTask);

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      { tasks: [{ workspace: { path: "C:/work/notes", name: "notes" } }] },
    );
  });

  it("rejects a malformed folder on a conversation", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [{ ...snapshot.tasks[0], workspace: { name: "notes" } }],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });

  it("rejects malformed folder history at the persistence boundary", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      recentWorkspaces: [{ name: "notes" }],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });

  /**
   * A status the writer can produce and the reader will not accept is a task
   * that saves and never loads — and because one damaged task fails the whole
   * file, it takes every other conversation with it.
   */
  it("restores an action that ran and answered without succeeding", async () => {
    const root = await temporaryRoot();
    const reported = taskWithActions([
      {
        id: "check-python",
        action: "Run a shell command",
        target: "command -v python3",
        sequence: 1,
        status: "reported",
        reason: "The command exited with code 1.",
      },
    ]);
    await new FileSessions(root).saveWorkspace(reported);

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      { tasks: [{ actions: [{ status: "reported" }] }] },
    );
  });

  it("restores the change an action made and what it reported", async () => {
    const root = await temporaryRoot();
    const reviewed = taskWithActions([
      {
        id: "write-brief",
        action: "Create a workspace file",
        target: "brief.md",
        sequence: 1,
        status: "completed",
        changes: [{ path: "brief.md", change: "created", after: "Hello." }],
        details: [
          { kind: "facts", items: [{ label: "Size", value: "6 bytes" }] },
        ],
      },
    ]);
    await new FileSessions(root).saveWorkspace(reviewed);

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      {
        tasks: [
          {
            actions: [
              {
                changes: [{ path: "brief.md", after: "Hello." }],
                details: [{ kind: "facts" }],
              },
            ],
          },
        ],
      },
    );
  });

  it("rejects a stored detail whose shape the interface could not draw", async () => {
    const root = await temporaryRoot();
    await plantHistory(root, {
      ...snapshot,
      tasks: [
        {
          ...snapshot.tasks[0],
          actions: [
            {
              id: "a",
              action: "Search workspace files",
              target: "budget",
              status: "completed",
              details: [{ kind: "matches", items: [{ path: "a.md" }] }],
            },
          ],
        },
      ],
    });

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });

  it("keeps history readable whatever state connections were in when it was saved", async () => {
    const root = await temporaryRoot();

    await new FileSessions(root).saveWorkspace({
      ...snapshot,
      mcpServers: [
        {
          id: "software-engineering/github",
          name: "GitHub",
          url: "https://api.githubcopilot.com/mcp/",
          enabled: true,
          status: "unauthorized",
          toolCount: 0,
          credential: { status: "saved" },
        },
      ],
    });

    await expect(new FileSessions(root).loadWorkspace()).resolves.toMatchObject(
      { tasks: [{ id: snapshot.tasks[0]!.id }] },
    );
  });

  it("stores conversations and choices, never what is only true while the app runs", async () => {
    const root = await temporaryRoot();

    await new FileSessions(root).saveWorkspace(snapshot);

    const saved = await savedSettings(root);
    expect(Object.keys(saved).sort()).toEqual(
      ["version", "conversations", "selectedTaskId", "preferences", "workspace"]
        .filter((key) => key in saved)
        .sort(),
    );
    for (const live of ["mcpServers", "plugins", "usage", "runtime", "browser"])
      expect(await savedText(root)).not.toContain(`"${live}"`);
  });
});
