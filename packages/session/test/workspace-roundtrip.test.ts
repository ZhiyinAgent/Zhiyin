import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot, WorkspaceTask } from "@zhiyin/contract";
import { FileSessions, SessionStoreError } from "../src/index.js";

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
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
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
      }),
    );

    await expect(new FileSessions(root).loadWorkspace()).rejects.toMatchObject({
      code: "corrupted",
    });
  });

  it("rejects malformed provider evidence without losing the saved file", async () => {
    const root = await temporaryRoot();
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
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
      }),
    );

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
      await writeFile(
        join(root, "workspace.json"),
        JSON.stringify({
          ...snapshot,
          tasks: [
            {
              ...snapshot.tasks[0],
              compaction: undefined,
              messages: [{ id: "a", role: "assistant", text: "", reasoning }],
            },
          ],
        }),
      );
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
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
        ...snapshot,
        tasks: [
          {
            ...snapshot.tasks[0],
            messages: [null],
            phase: { kind: "invented" },
          },
        ],
      }),
      "utf8",
    );
    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("rejects malformed specialist provenance and handoff state", async () => {
    const root = await temporaryRoot();
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
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
      }),
      "utf8",
    );

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("rejects malformed durable view source at the persistence boundary", async () => {
    const root = await temporaryRoot();
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
        ...snapshot,
        tasks: [
          { ...snapshot.tasks[0], views: [{ id: "view-1", kind: "diagram" }] },
        ],
      }),
      "utf8",
    );
    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("rejects a compaction checkpoint that cannot map back to durable history", async () => {
    const root = await temporaryRoot();
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
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
      }),
      "utf8",
    );

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });
  it("rejects a compaction checkpoint that names unavailable evidence", async () => {
    const root = await temporaryRoot();
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
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
      }),
      "utf8",
    );

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
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
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
      }),
      "utf8",
    );

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
    await writeFile(join(root, "workspace.json"), "not json", "utf8");

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
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
        ...snapshot,
        tasks: [{ ...snapshot.tasks[0], workspace: { name: "notes" } }],
      }),
      "utf8",
    );

    await expect(new FileSessions(root).loadWorkspace()).rejects.toBeInstanceOf(
      SessionStoreError,
    );
  });

  it("rejects malformed folder history at the persistence boundary", async () => {
    const root = await temporaryRoot();
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({ ...snapshot, recentWorkspaces: [{ name: "notes" }] }),
      "utf8",
    );

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
    await writeFile(
      join(root, "workspace.json"),
      JSON.stringify({
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
      }),
      "utf8",
    );

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

    const saved = JSON.parse(
      await readFile(join(root, "workspace.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(
      ["version", "tasks", "selectedTaskId", "preferences", "workspace"]
        .filter((key) => key in saved)
        .sort(),
    );
    for (const live of ["mcpServers", "plugins", "usage", "runtime", "browser"])
      expect(saved).not.toHaveProperty(live);
  });
});
