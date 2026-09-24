import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import {
  createWorkspaceState,
  listedConversations,
  workspaceReducer,
} from "./workspaceState.js";

describe("workspaceReducer", () => {
  it("reconstructs the visible task from a core snapshot and later events", () => {
    const snapshot: WorkspaceSnapshot = {
      runtime: { tasks: "available", capabilities: "unavailable" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Introduce yourself",
          updatedLabel: "Now",
          messages: [
            { id: "user-1", role: "user", text: "Introduce yourself" },
          ],
          actions: [
            {
              id: "read-package",
              action: "Read a workspace file",
              target: "package.json",
              status: "completed",
            },
          ],
          phase: {
            kind: "working",
            steps: [{ id: "model", label: "Ask model", status: "active" }],
          },
        },
      ],
      plugins: [],
      mcpServers: [],
      usage: { status: "unavailable", reason: "No usage yet." },
    };

    let state = workspaceReducer(createWorkspaceState(), {
      type: "workspaceHydrated",
      snapshot,
    });
    state = workspaceReducer(state, {
      type: "taskReplaced",
      task: {
        ...snapshot.tasks[0]!,
        messages: [
          ...snapshot.tasks[0]!.messages,
          { id: "assistant-1", role: "assistant", text: "Hello." },
        ],
        phase: {
          kind: "completed",
          outcome: { title: "Response complete", summary: "Hello." },
        },
      },
    });

    expect(state.connection).toBe("ready");
    expect(state.selectedTaskId).toBe("task-1");
    expect(state.tasks[0]).toMatchObject({
      messages: [{ role: "user" }, { role: "assistant", text: "Hello." }],
      actions: [
        {
          action: "Read a workspace file",
          target: "package.json",
          status: "completed",
        },
      ],
      phase: { kind: "completed" },
    });
  });
});

describe("a conversation's condensings", () => {
  it("are kept from the core, so the conversation can show where each happened", () => {
    const condensings = [
      {
        id: "condensing-1",
        sequence: 3,
        createdAt: "2026-09-24T10:00:00.000Z",
        targetTokens: 13_600,
        tokensBefore: 14_200,
        outcome: "failed" as const,
        reason: "unusable" as const,
      },
    ];

    const state = workspaceReducer(createWorkspaceState(), {
      type: "taskReplaced",
      task: {
        id: "task-1",
        title: "Long work",
        updatedLabel: "Now",
        messages: [],
        condensings,
        phase: { kind: "interrupted" },
      },
    });

    expect(state.tasks[0]?.condensings).toEqual(condensings);
  });

  it("say where the condensed part ends, and nothing once a rewind has cut through it", () => {
    const task = {
      id: "task-1",
      title: "Long work",
      updatedLabel: "Now",
      messages: [],
      compaction: {
        revision: 1,
        throughMessageId: "m9",
        summary: "Earlier work.",
        retainedActionIds: [],
        createdAt: "2026-09-25T10:00:00.000Z",
      },
      phase: { kind: "interrupted" as const },
    };

    let state = workspaceReducer(createWorkspaceState(), {
      type: "taskReplaced",
      task,
    });
    expect(state.tasks[0]?.condensedThrough).toBe("m9");

    const { compaction, ...rewound } = task;
    void compaction;
    state = workspaceReducer(state, { type: "taskReplaced", task: rewound });
    expect(state.tasks[0]?.condensedThrough).toBeUndefined();
  });
});

describe("the conversation list", () => {
  const opened = {
    id: "open",
    title: "Opened",
    updatedLabel: "Now",
    messages: [],
    actions: [],
    phase: { kind: "draft" as const },
  };
  const snapshot: WorkspaceSnapshot = {
    runtime: { tasks: "available", capabilities: "available" },
    selectedTaskId: "open",
    tasks: [opened],
    conversations: [
      { id: "open", title: "Opened", updatedLabel: "Now" },
      { id: "closed", title: "Never opened", updatedLabel: "Last week" },
    ],
    plugins: [],
    mcpServers: [],
    usage: { status: "unavailable", reason: "No usage yet." },
  };
  const hydrated = () =>
    workspaceReducer(createWorkspaceState(), {
      type: "workspaceHydrated",
      snapshot,
    });

  it("shows every conversation, including ones not opened yet", () => {
    expect(listedConversations(hydrated()).map((item) => item.id)).toEqual([
      "open",
      "closed",
    ]);
  });

  it("shows an opened conversation as it is now, and a new one first", () => {
    let state = workspaceReducer(hydrated(), {
      type: "taskReplaced",
      task: { ...opened, title: "Renamed" },
    });
    state = workspaceReducer(state, {
      type: "taskReplaced",
      task: { ...opened, id: "new", title: "New task" },
    });

    expect(listedConversations(state).map((item) => item.title)).toEqual([
      "New task",
      "Renamed",
      "Never opened",
    ]);
  });

  it("moves a conversation to the top when it changes", () => {
    const dated = workspaceReducer(createWorkspaceState(), {
      type: "workspaceHydrated",
      snapshot: {
        ...snapshot,
        tasks: [{ ...opened, updatedAt: "2026-09-01T10:00:00.000Z" }],
        conversations: [
          {
            id: "closed",
            title: "Never opened",
            updatedAt: "2026-09-02T10:00:00.000Z",
            updatedLabel: "Earlier",
          },
          {
            id: "open",
            title: "Opened",
            updatedAt: "2026-09-01T10:00:00.000Z",
            updatedLabel: "Earlier",
          },
        ],
      },
    });

    const changed = workspaceReducer(dated, {
      type: "taskReplaced",
      task: { ...opened, updatedAt: "2026-09-03T10:00:00.000Z" },
    });

    expect(listedConversations(dated).map((item) => item.id)).toEqual([
      "closed",
      "open",
    ]);
    expect(listedConversations(changed).map((item) => item.id)).toEqual([
      "open",
      "closed",
    ]);
  });

  it("drops a deleted conversation, opened or not", () => {
    const state = workspaceReducer(hydrated(), {
      type: "taskRemoved",
      taskId: "closed",
      selectedTaskId: "open",
    });

    expect(listedConversations(state).map((item) => item.id)).toEqual(["open"]);
  });
});
