/**
 * The demo's store, which is the only place the window's state changes without
 * the core saying so.
 */

import { describe, expect, it } from "vitest";
import { createWorkspaceState, type WorkspaceState } from "../ui/app/index.js";
import { demoReducer } from "./demoReducer.js";

function readyState(): WorkspaceState {
  return createWorkspaceState({
    connection: "ready",
    runtime: { tasks: "available", capabilities: "available" },
  });
}

describe("demoReducer", () => {
  it("creates, selects, and restores tasks by stable id", () => {
    let state = readyState();

    state = demoReducer(state, { type: "taskCreated", id: "first" });
    state = demoReducer(state, {
      type: "messageSubmitted",
      taskId: "first",
      message: "Review the project",
    });
    state = demoReducer(state, { type: "taskCreated", id: "second" });

    expect(state.selectedTaskId).toBe("second");
    expect(state.tasks.map((task) => task.id)).toEqual(["second", "first"]);

    state = demoReducer(state, { type: "taskSelected", id: "first" });
    expect(state.selectedTaskId).toBe("first");
    expect(state.tasks.find((task) => task.id === "first")?.title).toBe(
      "Review the project",
    );
  });

  it("does not show another conversation's browser after switching conversations", () => {
    let state = readyState();
    state = demoReducer(state, { type: "taskCreated", id: "first" });
    state = demoReducer(state, { type: "taskCreated", id: "second" });
    state = demoReducer(state, { type: "taskSelected", id: "first" });
    state = demoReducer(state, {
      type: "browserChanged",
      taskId: "first",
      browser: {
        status: "open",
        url: "https://first.example/",
        title: "First conversation",
        loading: false,
      },
    });

    state = demoReducer(state, { type: "taskSelected", id: "second" });

    expect(state.browser.status).toBe("closed");

    state = demoReducer(state, { type: "taskSelected", id: "first" });
    expect(state.browser.title).toBe("First conversation");
  });

  it("renames and removes conversations while keeping a valid selection", () => {
    let state = readyState();
    state = demoReducer(state, { type: "taskCreated", id: "first" });
    state = demoReducer(state, { type: "taskCreated", id: "second" });

    state = demoReducer(state, {
      type: "taskRenamed",
      taskId: "second",
      title: "  Project review  ",
    });
    expect(state.tasks[0]?.title).toBe("Project review");

    state = demoReducer(state, {
      type: "taskRemoved",
      taskId: "second",
      selectedTaskId: "first",
    });
    expect(state.tasks.map((task) => task.id)).toEqual(["first"]);
    expect(state.selectedTaskId).toBe("first");
  });

  it("represents each task phase as one non-contradictory state", () => {
    let state = readyState();
    state = demoReducer(state, { type: "taskCreated", id: "release" });
    state = demoReducer(state, {
      type: "messageSubmitted",
      taskId: "release",
      message: "Prepare release notes",
    });

    expect(state.tasks[0]?.phase.kind).toBe("working");

    state = demoReducer(state, {
      type: "approvalRequested",
      taskId: "release",
      prompt: {
        id: "publish",
        action: "Publish release notes",
        target: "docs.zhiyin.app",
        reason: "This sends the reviewed draft to the public site.",
        command: "pnpm docs:publish",
      },
    });
    expect(state.tasks[0]?.phase.kind).toBe("approval");

    state = demoReducer(state, {
      type: "taskCompleted",
      taskId: "release",
      outcome: {
        title: "Release notes are ready",
        summary: "The draft was checked against project history.",
      },
    });
    expect(state.tasks[0]?.phase.kind).toBe("completed");
  });

  it("keeps a denied preview action in history when it stops the task", () => {
    let state = readyState();
    state = demoReducer(state, { type: "taskCreated", id: "read" });
    state = demoReducer(state, {
      type: "approvalRequested",
      taskId: "read",
      prompt: {
        id: "read-package",
        action: "Read a workspace file",
        target: "package.json",
        reason: "Use project metadata to answer the current question.",
        command: 'read_file({"path":"package.json"})',
      },
    });

    state = demoReducer(state, {
      type: "approvalResolved",
      taskId: "read",
      allowed: false,
    });

    expect(state.tasks[0]).toMatchObject({
      actions: [
        {
          action: "Read a workspace file",
          target: "package.json",
          status: "denied",
        },
      ],
      phase: {
        kind: "interrupted",
        reason: "The action was denied. No further work ran.",
      },
    });
  });

  it("does not invent task execution when the runtime is unavailable", () => {
    let state = createWorkspaceState({ connection: "ready" });
    state = demoReducer(state, { type: "taskCreated", id: "draft" });
    state = demoReducer(state, {
      type: "messageSubmitted",
      taskId: "draft",
      message: "Run the task",
    });

    expect(state.tasks[0]?.phase.kind).toBe("draft");
    expect(state.tasks[0]?.messages).toHaveLength(0);
  });

  it("flips a plugin's and a component's switch without duplicating either", () => {
    let state = createWorkspaceState({
      connection: "ready",
      plugins: [
        {
          id: "research",
          name: "Deep Research & Synthesis",
          version: "1.0.0",
          description: "Find and verify sources.",
          category: "Research",
          publisher: "Zhiyin",
          source: "built-in",
          editing: "override",
          rollbackAvailable: false,
          enabled: true,
          status: "ready",
          defaultPrompts: [],
          components: [
            {
              id: "research/fact-checker",
              kind: "specialist",
              name: "Fact-checker",
              description: "Checks claims before completion.",
              enabled: true,
              status: "ready",
              editing: "override",
            },
          ],
        },
      ],
    });

    state = demoReducer(state, {
      type: "componentToggled",
      id: "research/fact-checker",
      enabled: false,
    });
    state = demoReducer(state, {
      type: "pluginToggled",
      id: "research",
      enabled: false,
    });

    expect(state.plugins).toHaveLength(1);
    expect(state.plugins[0]).toMatchObject({ enabled: false, status: "off" });
    expect(state.plugins[0]?.components).toEqual([
      expect.objectContaining({ enabled: false, status: "off" }),
    ]);
  });
});
