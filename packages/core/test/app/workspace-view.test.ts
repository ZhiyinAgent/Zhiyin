/**
 * What the space beside a conversation shows: nothing, the browser, a
 * document, or its 3D scene. It follows the surface the agent used last, opens on
 * its own once for a conversation's first document, and a person's choice
 * holds until the turn ends.
 */

import { describe, expect, it } from "vitest";
import type {
  AppEvent,
  BrowserPanelState,
  DocumentPanelState,
  SceneIntent,
  ScenePanelState,
} from "@zhiyin/contract";
import type { ModelEvent } from "@zhiyin/model-client";
import {
  documentViewerStub,
  stubDependencies,
  loopFrom,
  type LoopTestDependencies,
  type TestApp,
} from "./support.js";

/**
 * Built-in tools that write what they are asked to, one that reads a
 * document, and one that does a person's bidding mid-turn. The reading tool
 * names the workspace document it reads, and its first page, as
 * read_document does; a path outside the folder names none. close_document
 * says it closes the document, as the real one does.
 */
function writingTools(during?: { midTurn: () => Promise<void> }) {
  return {
    list: () => [
      {
        name: "write_file",
        description: "Write a file.",
        inputSchema: { type: "object" },
      },
      {
        name: "read_document",
        description: "Read a document.",
        inputSchema: { type: "object" },
      },
      {
        name: "close_document",
        description: "Close the document.",
        inputSchema: { type: "object" },
      },
      {
        name: "think",
        description: "Think.",
        inputSchema: { type: "object" },
      },
    ],
    inspect: async (name: string, args: unknown) => {
      const { path = "", pages } = args as { path?: string; pages?: string };
      const inside = name === "read_document" && !path.startsWith("..");
      return {
        ok: true as const,
        action: name,
        target: path,
        command: name,
        ...(inside
          ? { document: { path, page: Number(pages?.split("-")[0] ?? 1) } }
          : {}),
        ...(name === "close_document" ? { closesDocument: true as const } : {}),
      };
    },
    execute: async (name: string, args: unknown) => {
      await during?.midTurn();
      const path = (args as { path?: string }).path;
      return name === "write_file" && path
        ? {
            ok: true as const,
            value: { path },
            produced: [{ path, change: "created" as const, bytes: 10 }],
          }
        : { ok: true as const, value: {} };
    },
  };
}

/** A conversation's browser that a test opens, closes and acts on as the agent. */
function controllableBrowser() {
  let state: BrowserPanelState = {
    status: "closed",
    url: "",
    title: "",
    loading: false,
  };
  const states = new Set<(state: BrowserPanelState) => void>();
  const actions = new Set<() => void>();
  const publish = (next: BrowserPanelState) => {
    state = next;
    states.forEach((listener) => listener(next));
  };
  return {
    refresh: async () => {},
    availability: async () => ({
      available: true as const,
      browserName: "Test",
    }),
    state: () => state,
    lastFrame: () => undefined,
    automation: () => undefined,
    onState: (listener: (next: BrowserPanelState) => void) => {
      states.add(listener);
      return () => void states.delete(listener);
    },
    onFrame: () => () => {},
    markAgentAction: () => actions.forEach((listener) => listener()),
    onAgentAction: (listener: () => void) => {
      actions.add(listener);
      return () => void actions.delete(listener);
    },
    open: async () =>
      publish({
        status: "open",
        url: "https://example.test/",
        title: "Example",
        loading: false,
      }),
    navigate: async () => {},
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    click: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    close: async () =>
      publish({ status: "closed", url: "", title: "", loading: false }),
    /** As the agent would: one action, which opens the browser if it is not. */
    async agentActs() {
      this.markAgentAction();
      if (state.status === "closed") await this.open();
    },
  };
}

/**
 * Each conversation's 3D scene, which a test opens and changes as the
 * agent's commands would, and the looking the person asked of it.
 */
function controllableScenes() {
  const made = new Map<string, ReturnType<typeof scene>>();
  const listeners = new Set<
    (taskId: string, made: ReturnType<typeof scene>) => void
  >();
  const forgotten: string[] = [];
  function scene() {
    let state: ScenePanelState = {
      status: "closed",
      view: "camera",
      working: false,
    };
    let sequence = 0;
    const states = new Set<(state: ScenePanelState) => void>();
    const publish = (change: Partial<ScenePanelState>) => {
      state = { ...state, ...change };
      states.forEach((listener) => listener(state));
    };
    const picture = () => ({
      preview: {
        data: "",
        width: 640,
        height: 360,
        view: state.view,
        sequence: ++sequence,
      },
    });
    return {
      looked: [] as SceneIntent[],
      state: () => state,
      onState(listener: (state: ScenePanelState) => void) {
        states.add(listener);
        return () => void states.delete(listener);
      },
      look(intent: SceneIntent) {
        this.looked.push(intent);
      },
      /** The agent's first command: Blender starts and opens the file. */
      opens(file: string) {
        publish({ status: "starting" });
        publish({ status: "open", file, working: true });
        publish({ working: false, ...picture() });
      },
      /** A later command that changes the scene. */
      changes() {
        publish({ working: true });
        publish({ working: false, ...picture() });
      },
    };
  }
  return {
    forgotten,
    /** The conversation's scene, made as its first 3D command makes it. */
    of(taskId: string) {
      let found = made.get(taskId);
      if (!found) {
        found = scene();
        made.set(taskId, found);
        for (const listener of listeners) listener(taskId, found);
      }
      return found;
    },
    port: {
      existing: (taskId: string) => made.get(taskId),
      onScene(
        listener: (taskId: string, made: ReturnType<typeof scene>) => void,
      ) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      close: async () => {},
      forget: async (taskId: string) => {
        forgotten.push(taskId);
        made.delete(taskId);
      },
      closeAll: async () => {},
    },
  };
}

type Request = readonly [string, Record<string, unknown>] | "answer";

/**
 * A model that makes one request at a time, in order across turns: a tool
 * call, or the answer that ends the turn.
 */
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

function app(
  options: {
    readonly steps?: readonly Request[];
    readonly midTurn?: () => Promise<void>;
  } = {},
) {
  const events: AppEvent[] = [];
  const deps = stubDependencies((event) => events.push(event));
  const browser = controllableBrowser();
  const documents = documentViewerStub();
  const scenes = controllableScenes();
  let taskNumber = 0;
  const midTurn = { midTurn: async () => options.midTurn?.() };
  /** What the model was sent, request by request. */
  const sent: string[] = [];
  const answer = requests(...(options.steps ?? []));
  const loop = loopFrom({
    ...deps,
    newTaskId: () => `task-${++taskNumber}`,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    tools: writingTools(midTurn),
    documents,
    scenes: scenes.port,
    browsers: {
      browser: () => browser,
      close: async () => browser.close(),
      forget: async () => browser.close(),
      closeAll: async () => browser.close(),
    },
    workspace: {
      ...deps.workspace,
      selectWorkspace: async () => {},
    },
    model: {
      ...deps.model,
      send: (request) => {
        sent.push(JSON.stringify(request.messages));
        return answer();
      },
    },
  } satisfies LoopTestDependencies);
  return { loop, browser, documents, scenes, events, sent };
}

const view = (loop: TestApp) => loop.snapshot().workspaceView;
const shownPath = (loop: TestApp) => {
  const document: DocumentPanelState | undefined = loop.snapshot().document;
  return document && document.status !== "closed" ? document.path : undefined;
};

describe("the space beside a conversation", () => {
  it("shows nothing beside a new conversation", async () => {
    const { loop } = app();
    await loop.selectWorkspace("C:/work");
    await loop.createTask();
    expect(view(loop)).toBe("conversation");
    expect(loop.snapshot().document).toEqual({
      status: "closed",
      documents: [],
    });
  });

  it("opens on a conversation's first document write, and only that once", async () => {
    const { loop } = app({
      steps: [
        ["write_file", { path: "reports/q3.pdf" }],
        "answer",
        ["write_file", { path: "reports/q4.pdf" }],
        "answer",
      ],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the report");
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("reports/q3.pdf");

    await loop.chooseWorkspaceView(taskId, "conversation");
    await loop.start(taskId, "Write the next one");

    // The later write is drawn, ready for when the person looks, and does
    // not take the window back.
    expect(shownPath(loop)).toBe("reports/q4.pdf");
    expect(view(loop)).toBe("conversation");
  });

  it("does not open for a file that is not a document", async () => {
    const { loop } = app({
      steps: [["write_file", { path: "notes.md" }], "answer"],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Take notes");
    expect(view(loop)).toBe("conversation");
  });

  it("draws documents from the folder the conversation works in", async () => {
    const { loop, documents } = app({
      steps: [["write_file", { path: "q3.pdf" }], "answer"],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the report");
    expect(documents.roots).toEqual(["C:/work"]);
    await loop.showDocument(taskId, "q3.pdf");
    expect(documents.roots).toEqual(["C:/work", "C:/work"]);
  });

  it("follows the surface the agent used last", async () => {
    const { loop, browser } = app({
      steps: [
        ["write_file", { path: "q3.pdf" }],
        "answer",
        ["write_file", { path: "q4.pdf" }],
        "answer",
      ],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the report");
    expect(view(loop)).toBe("document");

    await browser.agentActs();
    expect(view(loop)).toBe("browser");

    await loop.start(taskId, "Write the next one");
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("q4.pdf");
  });

  it("shows the browser when the agent opens it, as it always has", async () => {
    let act = async () => {};
    const { loop, browser } = app({
      steps: [["think", {}], "answer"],
      midTurn: () => act(),
    });
    act = () => browser.agentActs();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Look it up");
    expect(view(loop)).toBe("browser");
  });

  it("keeps a person's choice made during a turn until that turn ends, and the agent's next write then shows", async () => {
    let choose = async () => {};
    const { loop, browser } = app({
      steps: [
        ["write_file", { path: "q3.pdf" }],
        "answer",
        ["write_file", { path: "q4.pdf" }],
        "answer",
        ["write_file", { path: "q5.pdf" }],
        "answer",
      ],
      midTurn: () => choose(),
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the report");
    await browser.agentActs();
    expect(view(loop)).toBe("browser");

    // The person picks the browser while the agent is writing.
    choose = async () => {
      choose = async () => {};
      await loop.chooseWorkspaceView(taskId, "browser");
    };
    await loop.start(taskId, "Write the next one");
    expect(view(loop)).toBe("browser");

    await loop.start(taskId, "And the one after");
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("q5.pdf");
  });

  it("shows a produced file the person opens, and refuses one outside the folder", async () => {
    const { loop } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();

    await expect(loop.showDocument(taskId, "brief.pdf")).resolves.toEqual({
      ok: true,
    });
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("brief.pdf");

    await expect(loop.showDocument(taskId, "../secret.pdf")).resolves.toEqual({
      ok: false,
      reason:
        "../secret.pdf is outside the folder this conversation works in, so it is not shown.",
    });
    expect(shownPath(loop)).toBe("brief.pdf");
  });

  it("opens a cited page the person clicks, and refuses a page the document does not have", async () => {
    const { loop } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();

    await expect(loop.showDocument(taskId, "q3.pdf", 2)).resolves.toEqual({
      ok: true,
    });
    expect(view(loop)).toBe("document");
    expect(loop.snapshot().document).toMatchObject({
      path: "q3.pdf",
      pointed: { page: 2 },
    });

    await expect(loop.showDocument(taskId, "q3.pdf", 9)).resolves.toEqual({
      ok: false,
      reason: "q3.pdf has 3 pages, so there is no page 9.",
    });
    expect(loop.snapshot().document).toMatchObject({ pointed: { page: 2 } });
  });

  it("gives the space to the open browser when the document closes, or back to the conversation", async () => {
    const { loop, browser } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.driveBrowser({ kind: "open" });
    expect(view(loop)).toBe("browser");
    await loop.showDocument(taskId, "brief.pdf");
    expect(view(loop)).toBe("document");

    await loop.closeDocument(taskId);
    expect(view(loop)).toBe("browser");

    await loop.showDocument(taskId, "brief.pdf");
    await browser.close();
    expect(view(loop)).toBe("document");
    await loop.closeDocument(taskId);
    expect(view(loop)).toBe("conversation");
  });

  it("refuses a choice of something the conversation does not have open", async () => {
    const { loop } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await expect(loop.chooseWorkspaceView(taskId, "browser")).rejects.toThrow(
      "This conversation has no browser open.",
    );
    await expect(loop.chooseWorkspaceView(taskId, "document")).rejects.toThrow(
      "This conversation has no document open.",
    );
    expect(view(loop)).toBe("conversation");
  });

  it("shows each conversation's own document and view when switching between them", async () => {
    const { loop, events } = app();
    await loop.selectWorkspace("C:/work");
    const first = await loop.createTask();
    await loop.showDocument(first, "first.pdf");
    const second = await loop.createTask();
    expect(view(loop)).toBe("conversation");
    expect(loop.snapshot().document?.status).toBe("closed");

    events.length = 0;
    await loop.selectTask(first);
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("first.pdf");
    expect(events).toContainEqual({
      kind: "workspaceViewChanged",
      data: { taskId: first, view: "document" },
    });
    expect(
      events.some(
        (event) =>
          event.kind === "documentChanged" &&
          event.data.taskId === first &&
          event.data.document.status === "shown",
      ),
    ).toBe(true);
    void second;
  });

  it("tells the window when a document or the view changes", async () => {
    const { loop, events } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    events.length = 0;
    await loop.showDocument(taskId, "brief.pdf");
    expect(events).toContainEqual({
      kind: "workspaceViewChanged",
      data: { taskId, view: "document" },
    });
    expect(
      events.find((event) => event.kind === "documentChanged"),
    ).toMatchObject({
      data: { taskId, document: { status: "shown", path: "brief.pdf" } },
    });
  });

  it("lets go of a deleted conversation's document", async () => {
    const { loop, documents } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.showDocument(taskId, "brief.pdf");
    await loop.deleteTask(taskId);
    expect(documents.state(taskId).status).toBe("closed");
  });
});

describe("a document the agent reads", () => {
  it("is shown beside the conversation at the first page read, and the agent is told so", async () => {
    const { loop, sent } = app({
      steps: [
        ["read_document", { path: "reports/q3.pdf", pages: "2-3" }],
        "answer",
      ],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "What does page 2 say?");

    expect(view(loop)).toBe("document");
    expect(loop.snapshot().document).toMatchObject({
      path: "reports/q3.pdf",
      pointed: { page: 2 },
    });
    expect(sent.at(-1)).toContain(
      "Shown to the person beside the conversation, at page 2.",
    );
  });

  it("follows reads as it follows writes, and never reopens a space the person put away", async () => {
    const { loop, sent } = app({
      steps: [
        ["read_document", { path: "q3.pdf" }],
        "answer",
        ["read_document", { path: "q4.pdf" }],
        "answer",
      ],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Read the report");
    expect(view(loop)).toBe("document");

    await loop.chooseWorkspaceView(taskId, "conversation");
    await loop.start(taskId, "Read the next one");
    expect(shownPath(loop)).toBe("q4.pdf");
    expect(view(loop)).toBe("conversation");
    expect(sent.at(-1)).toContain(
      "Not on screen: the person put the space beside the conversation away. It is there when they open it.",
    );
  });

  it("leaves the browser on screen when the person chose it during the turn, and the agent is told so", async () => {
    let choose = async () => {};
    const { loop, browser, sent } = app({
      steps: [["think", {}], ["read_document", { path: "q3.pdf" }], "answer"],
      midTurn: () => choose(),
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await browser.agentActs();
    choose = async () => {
      choose = async () => {};
      await loop.chooseWorkspaceView(taskId, "browser");
    };
    await loop.start(taskId, "Read the report");

    expect(view(loop)).toBe("browser");
    expect(shownPath(loop)).toBe("q3.pdf");
    expect(sent.at(-1)).toContain(
      "Not on screen: the person chose to look at the browser during this turn. It stays as they chose.",
    );
  });

  it("is shown at its first page when the page read is past its end", async () => {
    const { loop, sent } = app({
      steps: [["read_document", { path: "q3.pdf", pages: "9" }], "answer"],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Read page 9");

    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("q3.pdf");
    expect(sent.at(-1)).toContain(
      "Shown to the person beside the conversation, at page 1.",
    );
  });

  it("shows nothing for a document outside the folder", async () => {
    const { loop, documents } = app({
      steps: [["read_document", { path: "../elsewhere/q3.pdf" }], "answer"],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Read that one");
    expect(view(loop)).toBe("conversation");
    expect(documents.roots).toEqual([]);
  });
});

describe("a document the agent closes", () => {
  it("gives the space to the open browser, and the agent is told what is shown", async () => {
    const { loop, browser, sent } = app({
      steps: [
        ["read_document", { path: "q3.pdf" }],
        ["close_document", {}],
        "answer",
      ],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await browser.agentActs();
    await loop.start(taskId, "Point at the page, then answer");

    expect(shownPath(loop)).toBeUndefined();
    expect(view(loop)).toBe("browser");
    expect(sent.at(-1)).toContain(
      "Closed. The space beside the conversation shows the browser.",
    );
  });

  it("leaves the conversation alone when no browser is open, and says so", async () => {
    const { loop, sent } = app({
      steps: [
        ["read_document", { path: "q3.pdf" }],
        ["close_document", {}],
        "answer",
      ],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Point at the page, then answer");

    expect(view(loop)).toBe("conversation");
    expect(sent.at(-1)).toContain(
      "Closed. The person sees the conversation alone.",
    );
  });

  it("keeps the document the person chose to look at during the turn, and the agent is told so", async () => {
    // The person chooses the document while close_document runs.
    let calls = 0;
    let choose = async () => {};
    const { loop, sent } = app({
      steps: [
        ["read_document", { path: "q3.pdf" }],
        ["close_document", {}],
        "answer",
      ],
      midTurn: async () => {
        if (++calls === 2) await choose();
      },
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    choose = () => loop.chooseWorkspaceView(taskId, "document");
    await loop.start(taskId, "Point at the page, then answer");

    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("q3.pdf");
    expect(sent.at(-1)).toContain(
      "Not closed: the person chose to look at the document during this turn. It stays as they chose.",
    );
  });

  it("says when no document was shown", async () => {
    const { loop, sent } = app({ steps: [["close_document", {}], "answer"] });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Close it");
    expect(sent.at(-1)).toContain(
      "No document was shown beside the conversation.",
    );
  });
});

describe("a conversation's 3D scene", () => {
  /** A turn in which the agent does one thing to the scene, then answers. */
  function sceneApp(...steps: readonly Request[]) {
    let act = async () => {};
    const made = app({ steps, midTurn: () => act() });
    return {
      ...made,
      /** What the agent's next tool call does, besides itself. */
      during: (next: () => void | Promise<void>) => {
        act = async () => {
          act = async () => {};
          await next();
        };
      },
    };
  }

  it("is shown when it first appears, as the browser is", async () => {
    const { loop, scenes, during } = sceneApp(["think", {}], "answer");
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => scenes.of(taskId).opens("shelf.blend"));
    await loop.start(taskId, "Model a shelf");
    expect(view(loop)).toBe("scene");
    expect(loop.snapshot().scene).toMatchObject({
      status: "open",
      file: "shelf.blend",
      working: false,
    });
  });

  it("does not take the space when the person chose during the turn", async () => {
    const { loop, scenes, during } = sceneApp(["think", {}], "answer");
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(async () => {
      await loop.chooseWorkspaceView(taskId, "conversation");
      scenes.of(taskId).opens("shelf.blend");
    });
    await loop.start(taskId, "Model a shelf");
    expect(view(loop)).toBe("conversation");
    expect(loop.snapshot().scene?.status).toBe("open");
  });

  it("follows the agent from a document to its scene, and never reopens a space the person put away", async () => {
    const { loop, scenes, during } = sceneApp(
      ["think", {}],
      "answer",
      ["write_file", { path: "plan.pdf" }],
      "answer",
      ["think", {}],
      "answer",
      ["think", {}],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => scenes.of(taskId).opens("flat.blend"));
    await loop.start(taskId, "Build the flat");
    await loop.start(taskId, "Write up the plan");
    expect(view(loop)).toBe("document");

    during(() => scenes.of(taskId).changes());
    await loop.start(taskId, "Paint the walls");
    expect(view(loop)).toBe("scene");

    await loop.chooseWorkspaceView(taskId, "conversation");
    during(() => scenes.of(taskId).changes());
    await loop.start(taskId, "Add a sofa");
    expect(view(loop)).toBe("conversation");
  });

  it("gives the space to a picture the agent writes while the scene shows", async () => {
    const { loop, scenes, during } = sceneApp(
      ["write_file", { path: "brief.pdf" }],
      "answer",
      ["think", {}],
      "answer",
      ["write_file", { path: "renders/can.png" }],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Read the brief");
    during(() => scenes.of(taskId).opens("can.blend"));
    await loop.start(taskId, "Model the can");
    expect(view(loop)).toBe("scene");

    await loop.start(taskId, "Render it");
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("renders/can.png");
  });

  it("takes the space back when the browser or a document closes", async () => {
    const { loop, browser, scenes, during } = sceneApp(["think", {}], "answer");
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => scenes.of(taskId).opens("shelf.blend"));
    await loop.start(taskId, "Model a shelf");
    await browser.agentActs();
    expect(view(loop)).toBe("browser");

    await browser.close();
    expect(view(loop)).toBe("scene");

    await loop.showDocument(taskId, "brief.pdf");
    expect(view(loop)).toBe("document");
    await loop.closeDocument(taskId);
    expect(view(loop)).toBe("scene");
  });

  it("refuses the 3D view, and looking at it, in a conversation without a scene", async () => {
    const { loop } = sceneApp();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await expect(loop.chooseWorkspaceView(taskId, "scene")).rejects.toThrow(
      "This conversation has no 3D scene.",
    );
    await expect(loop.lookAtScene({ kind: "reset" })).rejects.toThrow(
      "This conversation has no 3D scene.",
    );
    expect(view(loop)).toBe("conversation");
  });

  it("passes the person's turning to the open conversation's own scene", async () => {
    const { loop, scenes } = sceneApp();
    await loop.selectWorkspace("C:/work");
    const first = await loop.createTask();
    scenes.of(first).opens("first.blend");
    const second = await loop.createTask();
    scenes.of(second).opens("second.blend");

    await loop.selectTask(first);
    await loop.lookAtScene({ kind: "turn", yaw: 15, pitch: 0 });
    expect(scenes.of(first).looked).toEqual([
      { kind: "turn", yaw: 15, pitch: 0 },
    ]);
    expect(scenes.of(second).looked).toEqual([]);
  });

  it("tells the window each change, and shows each conversation's own scene", async () => {
    const { loop, scenes, events } = sceneApp();
    await loop.selectWorkspace("C:/work");
    const first = await loop.createTask();
    events.length = 0;
    scenes.of(first).opens("first.blend");
    expect(events).toContainEqual({
      kind: "sceneChanged",
      data: { taskId: first, scene: scenes.of(first).state() },
    });

    await loop.createTask();
    expect(loop.snapshot().scene?.status).toBe("closed");
    await loop.selectTask(first);
    expect(loop.snapshot().scene).toMatchObject({ file: "first.blend" });
  });

  it("lets go of a deleted conversation's scene", async () => {
    const { loop, scenes, events } = sceneApp();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    const scene = scenes.of(taskId);
    scene.opens("shelf.blend");
    await loop.deleteTask(taskId);
    expect(scenes.forgotten).toEqual([taskId]);

    events.length = 0;
    scene.changes();
    expect(events.some((event) => event.kind === "sceneChanged")).toBe(false);
  });
});
