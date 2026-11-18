/**
 * The one 3D view beside a conversation, which shows its Blender scene or the
 * parts its CAD studio built: when the space opens on them and follows them,
 * which of the two it shows, what the window is told, the mesh it reads, and
 * what going back does to them.
 */

import { describe, expect, it } from "vitest";
import type { AppEvent } from "@zhiyin/contract";
import { ConversationRewind } from "@zhiyin/rewind-planner";
import type { ModelEvent } from "@zhiyin/model-client";
import {
  documentViewerStub,
  loopFrom,
  stubDependencies,
  type LoopTestDependencies,
  type TestApp,
} from "./support.js";
import { controllableParts, controllableScenes } from "./three-d.js";

type Request = readonly [string, Record<string, unknown>] | "answer";

/** A model that makes one request at a time, in order across turns. */
function requests(...steps: readonly Request[]) {
  let request = 0;
  return async function* (): AsyncGenerator<ModelEvent> {
    const step = steps[request++];
    if (step && step !== "answer")
      yield {
        kind: "toolCallDelta",
        index: 0,
        callId: `call-${request}`,
        name: step[0],
        argumentsDelta: JSON.stringify(step[1]),
      };
    else yield { kind: "textDelta", text: "Done" };
    yield { kind: "done" };
  };
}

/** A conversation whose agent builds, writes documents, and thinks. */
function app(...steps: readonly Request[]) {
  const events: AppEvent[] = [];
  const deps = stubDependencies((event) => events.push(event));
  const parts = controllableParts();
  const scenes = controllableScenes();
  let act = async () => {};
  let taskNumber = 0;
  const answer = requests(...steps);
  const loop = loopFrom({
    ...deps,
    rewind: new ConversationRewind(() => "rewind-1"),
    newTaskId: () => `task-${++taskNumber}`,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    tools: {
      list: () =>
        ["write_file", "think"].map((name) => ({
          name,
          description: name,
          inputSchema: { type: "object" },
        })),
      inspect: async (name: string, args: unknown) => ({
        ok: true as const,
        action: name,
        target: (args as { path?: string }).path ?? "",
        command: name,
      }),
      execute: async (name: string, args: unknown) => {
        const next = act;
        act = async () => {};
        await next();
        const path = (args as { path?: string }).path;
        return name === "write_file" && path
          ? {
              ok: true as const,
              value: { path },
              produced: [{ path, change: "created" as const, bytes: 10 }],
            }
          : { ok: true as const, value: "ok" };
      },
    },
    documents: documentViewerStub(),
    parts: parts.port,
    scenes: scenes.port,
    workspace: {
      ...deps.workspace,
      enterFolder: async () => "workspace",
      checkFolder: async () => "workspace",
    },
    model: { ...deps.model, send: () => answer() },
  } satisfies LoopTestDependencies);
  return {
    loop,
    parts,
    scenes,
    events,
    /** What the agent's next tool call does, besides itself. */
    during: (next: () => void) => {
      act = async () => next();
    },
  };
}

const view = (loop: TestApp) => loop.snapshot().workspaceView;
/** What the 3D view shows, when the space shows it. */
const in3d = (loop: TestApp) =>
  loop.snapshot().workspaceView === "3d" ? loop.snapshot().threeD : undefined;

async function goBack(loop: TestApp, taskId: string, text: string) {
  const message = loop
    .snapshot()
    .tasks.find((task) => task.id === taskId)
    ?.messages.find((each) => each.text === text);
  if (!message) throw new Error(`No message says ${text}`);
  const preview = await loop.rewinds.preview(taskId, message.id);
  await loop.commitRewind(taskId, preview.id, "keep");
}

describe("the parts a conversation built", () => {
  it("are shown when the first build arrives, unless the person put the space away during the turn", async () => {
    const { loop, parts, during } = app(["think", {}], "answer");
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => parts.built(taskId, "Gear"));
    await loop.start(taskId, "Make me a gear");
    expect(in3d(loop)).toBe("parts");
    expect(loop.snapshot().parts).toEqual(parts.port.state(taskId));

    const held = app(["think", {}], "answer");
    await held.loop.selectWorkspace("C:/work");
    const other = await held.loop.createTask();
    held.during(() => {
      void held.loop.surfaces.chooseWorkspaceView(other, "conversation");
      held.parts.built(other, "Gear");
    });
    await held.loop.start(other, "Make me a gear");
    expect(view(held.loop)).toBe("conversation");
  });

  it("follow the agent's next build from a document, and never reopen a space the person put away", async () => {
    const { loop, parts, during } = app(
      ["think", {}],
      "answer",
      ["write_file", { path: "notes.pdf" }],
      "answer",
      ["think", {}],
      "answer",
      ["think", {}],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => parts.built(taskId, "Gear"));
    await loop.start(taskId, "Make me a gear");
    await loop.start(taskId, "Write the notes");
    expect(view(loop)).toBe("document");

    during(() => parts.built(taskId, "Gear", "Pinion"));
    await loop.start(taskId, "Add the pinion");
    expect(in3d(loop)).toBe("parts");

    await loop.surfaces.chooseWorkspaceView(taskId, "conversation");
    during(() => parts.built(taskId, "Gear", "Pinion"));
    await loop.start(taskId, "Thin the teeth");
    expect(view(loop)).toBe("conversation");
  });

  it("take the space back when a document closes", async () => {
    const { loop, parts, during } = app(["think", {}], "answer");
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => parts.built(taskId, "Gear"));
    await loop.start(taskId, "Make me a gear");

    await loop.surfaces.showDocument(taskId, "brief.pdf");
    expect(view(loop)).toBe("document");
    await loop.surfaces.closeDocument(taskId);
    expect(in3d(loop)).toBe("parts");
  });

  it("are refused to the 3D view in a conversation that built nothing", async () => {
    const { loop } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await expect(
      loop.surfaces.chooseWorkspaceView(taskId, "3d", "parts"),
    ).rejects.toThrow("This conversation has built no parts.");
    await expect(
      loop.surfaces.chooseWorkspaceView(taskId, "3d"),
    ).rejects.toThrow("This conversation has nothing to show in 3D.");
  });

  it("give the window the mesh of the build it shows, and nothing for one replaced since", async () => {
    const { loop, parts } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    const first = parts.built(taskId, "Gear");
    const second = parts.built(taskId, "Gear");

    expect(await loop.surfaces.partModel(taskId, second.sequence)).toEqual({
      sequence: second.sequence,
      data: new Uint8Array([103, 108, 84, 70]),
    });
    expect(
      await loop.surfaces.partModel(taskId, first.sequence),
    ).toBeUndefined();
    await expect(loop.surfaces.partModel("no-such-task", 1)).rejects.toThrow();
  });

  it("tell the window each build, and show each conversation's own parts", async () => {
    const { loop, parts, events } = app();
    await loop.selectWorkspace("C:/work");
    const first = await loop.createTask();
    events.length = 0;
    const built = parts.built(first, "Gear");
    expect(events).toContainEqual({
      kind: "partsChanged",
      data: { taskId: first, parts: built },
    });

    await loop.createTask();
    expect(loop.snapshot().parts).toBeUndefined();
    await loop.selectTask(first);
    expect(loop.snapshot().parts).toEqual(built);
  });

  it("are told to the window again when their conversation is selected, as a window just opened needs", async () => {
    const { loop, parts, events } = app();
    await loop.selectWorkspace("C:/work");
    const first = await loop.createTask();
    const built = parts.built(first, "Gear");
    await loop.createTask();
    events.length = 0;

    await loop.selectTask(first);

    expect(events).toContainEqual({
      kind: "partsChanged",
      data: { taskId: first, parts: built },
    });
  });

  it("are put away when going back removes the turn that built them, and kept when it does not", async () => {
    const { loop, parts, during } = app(
      ["think", {}],
      "answer",
      "answer",
      ["think", {}],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => parts.built(taskId, "Gear"));
    await loop.start(taskId, "Make me a gear");
    await loop.start(taskId, "Thanks");

    await goBack(loop, taskId, "Thanks");
    expect(parts.putAway).toEqual([]);
    expect(in3d(loop)).toBe("parts");

    during(() => parts.built(taskId, "Gear"));
    await loop.start(taskId, "Thin the teeth");
    await goBack(loop, taskId, "Thin the teeth");
    expect(parts.putAway).toEqual([taskId]);
    expect(loop.snapshot().parts).toBeUndefined();
    expect(view(loop)).toBe("conversation");
  });

  it("are let go of with a deleted conversation", async () => {
    const { loop, parts, events } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    parts.built(taskId, "Gear");

    await loop.deleteTask(taskId);
    expect(parts.forgotten).toEqual([taskId]);
    events.length = 0;
    parts.built(taskId, "Gear");
    expect(events.some((event) => event.kind === "partsChanged")).toBe(false);
  });
});

describe("a conversation's 3D scene", () => {
  it("is neither shown nor chosen while Blender is starting, and is once the scene is open", async () => {
    const { loop, scenes } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    scenes.of(taskId).starts();
    expect(loop.snapshot().scene?.status).toBe("starting");
    expect(view(loop)).toBe("conversation");
    await expect(
      loop.surfaces.chooseWorkspaceView(taskId, "3d"),
    ).rejects.toThrow("This conversation has nothing to show in 3D.");
    await expect(
      loop.surfaces.chooseWorkspaceView(taskId, "3d", "scene"),
    ).rejects.toThrow("This conversation has no 3D scene.");

    scenes.of(taskId).opens("bottle.blend");
    expect(in3d(loop)).toBe("scene");
    await loop.surfaces.chooseWorkspaceView(taskId, "conversation");
    await loop.surfaces.chooseWorkspaceView(taskId, "3d");
    expect(in3d(loop)).toBe("scene");
  });
});

describe("the 3D view of a conversation with a scene and parts", () => {
  it("shows whichever of the two the agent used last, and tells the window", async () => {
    const { loop, parts, scenes, events, during } = app(
      ["think", {}],
      "answer",
      ["think", {}],
      "answer",
      ["think", {}],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => scenes.of(taskId).opens("desk.blend"));
    await loop.start(taskId, "Model the desk");
    expect(in3d(loop)).toBe("scene");

    during(() => parts.built(taskId, "Bracket"));
    await loop.start(taskId, "Make a bracket to print");
    expect(in3d(loop)).toBe("parts");
    expect(events).toContainEqual({
      kind: "workspaceViewChanged",
      data: { taskId, view: "3d", threeD: "parts" },
    });

    during(() => scenes.of(taskId).changes());
    await loop.start(taskId, "Put the bracket under the desk");
    expect(in3d(loop)).toBe("scene");
  });

  it("shows the one the person picked while the agent changes it, and the other when the agent builds it again", async () => {
    const { loop, parts, scenes, during } = app(
      ["think", {}],
      "answer",
      ["think", {}],
      "answer",
      ["think", {}],
      ["think", {}],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => scenes.of(taskId).opens("desk.blend"));
    await loop.start(taskId, "Model the desk");
    during(() => parts.built(taskId, "Bracket"));
    await loop.start(taskId, "Make a bracket to print");

    let afterChoosing: string | undefined;
    during(async () => {
      await loop.surfaces.chooseWorkspaceView(taskId, "3d", "scene");
      scenes.of(taskId).changes();
      afterChoosing = in3d(loop);
      during(() => parts.built(taskId, "Bracket"));
    });
    await loop.start(
      taskId,
      "Put the desk in the corner, then thicken the bracket",
    );

    expect(afterChoosing).toBe("scene");
    expect(in3d(loop)).toBe("parts");
  });

  it("shows the other when one goes, and leaves the space when both have", async () => {
    const { loop, parts, scenes, during } = app(
      ["think", {}],
      "answer",
      ["think", {}],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => scenes.of(taskId).opens("desk.blend"));
    await loop.start(taskId, "Model the desk");
    during(() => parts.built(taskId, "Bracket"));
    await loop.start(taskId, "Make a bracket to print");
    expect(in3d(loop)).toBe("parts");

    await goBack(loop, taskId, "Make a bracket to print");
    expect(in3d(loop)).toBe("scene");
    await goBack(loop, taskId, "Model the desk");
    expect(view(loop)).toBe("conversation");
  });
});
