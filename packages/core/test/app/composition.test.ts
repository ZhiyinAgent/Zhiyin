/**
 * The core and a turn together: what a turn leaves saved, what a restart finds,
 * and what the window is told about it. A turn's own behaviour is tested in the
 * loop's own package, against a stand-in for the app around it.
 */

import { describe, expect, it } from "vitest";
import type { AppEvent, WorkspaceSnapshot } from "@zhiyin/contract";
import {
  loopFrom,
  pluginStore,
  pluginView,
  stubDependencies,
} from "./support.js";

describe("the core and a turn together", () => {
  it("preserves damaged history and keeps optional settings failure isolated", async () => {
    let saves = 0;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        loadWorkspace: async () => {
          throw new Error("damaged");
        },
        saveWorkspace: async () => {
          saves += 1;
        },
      },
      mcp: {
        ...deps.mcp,
        manage: async () => {
          throw new Error("offline");
        },
      },
    });
    await loop.initialize();
    expect(loop.snapshot().runtime.tasks).toBe("unavailable");
    expect(loop.snapshot().issues?.length).toBeGreaterThan(0);
    await expect(loop.createTask()).rejects.toThrow("Restore saved history");
    expect(saves).toBe(0);
  });

  it("renames a task with a non-empty trimmed title and persists it", async () => {
    const saved: WorkspaceSnapshot[] = [];
    const seen: AppEvent[] = [];
    const loop = loopFrom({
      ...stubDependencies((event) => seen.push(event)),
      sessions: {
        ...stubDependencies(() => {}).sessions,
        saveWorkspace: async (snapshot) => saved.push(snapshot),
      },
    });
    const taskId = await loop.createTask();

    await loop.renameTask(taskId, "  Project review  ");

    expect(loop.snapshot().tasks[0]?.title).toBe("Project review");
    expect(saved.at(-1)?.tasks[0]?.title).toBe("Project review");
    expect(seen.at(-1)).toMatchObject({
      kind: "taskChanged",
      data: { id: taskId, title: "Project review" },
    });
    await expect(loop.renameTask(taskId, "   ")).rejects.toThrow(
      "Enter a conversation name.",
    );
  });

  it("saves what the model was sent, and never sends it to the window", async () => {
    const saved: WorkspaceSnapshot[] = [];
    const seen: AppEvent[] = [];
    const loop = loopFrom({
      ...stubDependencies(
        (event) => seen.push(event),
        [{ kind: "textDelta", text: "Hello." }, { kind: "done" }],
      ),
      sessions: {
        ...stubDependencies(() => {}).sessions,
        saveWorkspace: async (snapshot) => saved.push(snapshot),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Hi");
    await loop.renameTask(taskId, "Greeting");

    expect(saved.at(-1)?.tasks[0]?.modelHistory?.length).toBeGreaterThan(0);
    expect(seen.some((event) => event.kind === "taskChanged")).toBe(true);
    expect(JSON.stringify(seen)).not.toContain("modelHistory");
  });

  it("deletes a task and selects its nearest remaining conversation", async () => {
    let nextId = 0;
    const saved: WorkspaceSnapshot[] = [];
    const seen: AppEvent[] = [];
    const loop = loopFrom({
      ...stubDependencies((event) => seen.push(event)),
      sessions: {
        ...stubDependencies(() => {}).sessions,
        saveWorkspace: async (snapshot) => saved.push(snapshot),
      },
      newTaskId: () => `task-${(nextId += 1)}`,
    });
    const first = await loop.createTask();
    const second = await loop.createTask();

    await loop.deleteTask(second);

    expect(loop.snapshot().tasks.map((task) => task.id)).toEqual([first]);
    expect(loop.snapshot().selectedTaskId).toBe(first);
    expect(saved.at(-1)?.tasks.map((task) => task.id)).toEqual([first]);
    expect(seen.at(-1)).toEqual({
      kind: "taskRemoved",
      data: { taskId: second, selectedTaskId: first },
    });
  });

  it("removes what a deleted conversation kept, and nothing of another's", async () => {
    let nextId = 0;
    const forgotten: string[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      sessions: {
        ...deps.sessions,
        forgetConversation: async (taskId) => {
          forgotten.push(taskId);
        },
      },
      newTaskId: () => `task-${(nextId += 1)}`,
    });
    await loop.createTask();
    const second = await loop.createTask();

    await loop.deleteTask(second);

    expect(forgotten).toEqual([second]);
  });

  it("rehydrates and updates the same workspace snapshot across a restart", async () => {
    const restored: WorkspaceSnapshot = {
      runtime: { tasks: "available", capabilities: "unavailable" },
      selectedTaskId: "restored",
      tasks: [
        {
          id: "restored",
          title: "Earlier task",
          updatedLabel: "Yesterday",
          messages: [{ id: "m1", role: "user", text: "Earlier message" }],
          phase: { kind: "interrupted" },
        },
      ],
      skills: [],
      subagents: [],
      usage: { status: "unavailable", reason: "No usage yet." },
    };
    const saved: WorkspaceSnapshot[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      sessions: {
        ...stubDependencies(() => {}).sessions,
        loadWorkspace: async () => restored,
        saveWorkspace: async (snapshot) => saved.push(snapshot),
        list: async () => [],
        undo: async () => {},
      },
    });

    await loop.initialize();
    const created = await loop.createTask();

    expect(loop.snapshot().tasks.map((task) => task.id)).toEqual([
      "task-1",
      "restored",
    ]);
    expect(loop.snapshot().selectedTaskId).toBe(created);
    expect(saved.at(-1)).toEqual(loop.snapshot());
  });

  it("restores an unfinished permission request as interrupted instead of leaving a dead prompt", async () => {
    const restored: WorkspaceSnapshot = {
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "restored",
      tasks: [
        {
          id: "restored",
          title: "Interrupted approval",
          updatedLabel: "Earlier",
          messages: [{ id: "m1", role: "user", text: "Read the notes" }],
          phase: {
            kind: "approval",
            steps: [],
            prompt: {
              id: "stale-call",
              action: "Read a workspace file",
              target: "README.md",
              reason: "Review this action.",
              command: 'read_file({"path":"README.md"})',
            },
          },
        },
      ],
      skills: [],
      subagents: [],
      usage: { status: "unavailable", reason: "No usage yet." },
    };
    const saved: WorkspaceSnapshot[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      sessions: {
        ...stubDependencies(() => {}).sessions,
        loadWorkspace: async () => restored,
        saveWorkspace: async (snapshot) => saved.push(snapshot),
        list: async () => [],
        undo: async () => {},
      },
    });

    await loop.initialize();

    expect(loop.snapshot().tasks[0]?.phase).toEqual({ kind: "interrupted" });
    expect(saved.at(-1)?.tasks[0]?.phase).toEqual({ kind: "interrupted" });
  });

  it("publishes a component switch from the plugin that owns it", async () => {
    const seen: AppEvent[] = [];
    const loop = loopFrom({
      ...stubDependencies((event) => seen.push(event)),
      plugins: pluginStore([
        pluginView({
          name: "research",
          displayName: "Deep Research & Synthesis",
          skills: [
            {
              id: "source-triangulation",
              description: "Checks current facts.",
              instructions: "Read primary sources.",
            },
          ],
        }),
      ]),
    });
    await loop.initialize();

    await loop.setComponentEnabled("research/source-triangulation", false);

    expect(loop.snapshot().plugins).toMatchObject([
      {
        id: "research",
        status: "off",
        components: [
          {
            id: "research/source-triangulation",
            enabled: false,
            status: "off",
          },
        ],
      },
    ]);
    expect(seen).toContainEqual({
      kind: "pluginsChanged",
      data: [
        expect.objectContaining({
          id: "research",
          components: [
            expect.objectContaining({
              id: "research/source-triangulation",
              enabled: false,
            }),
          ],
        }),
      ],
    });
  });
});
