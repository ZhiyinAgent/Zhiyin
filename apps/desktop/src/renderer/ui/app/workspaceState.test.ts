import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
import { createWorkspaceState, workspaceReducer } from "./workspaceState.js";

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
