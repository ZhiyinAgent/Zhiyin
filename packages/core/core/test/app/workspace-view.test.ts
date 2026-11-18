/**
 * What the space beside a conversation shows: nothing, the browser, a
 * document, or its 3D scene. It follows the surface the agent used last, opens on
 * its own once for a conversation's first document, and a person's choice
 * holds until the agent makes something new elsewhere.
 */

import { describe, expect, it } from "vitest";
import type {
  AppEvent,
  BrowserPanelState,
  DocumentPanelState,
} from "@zhiyin/contract";
import { fakeBrowser, fakeBrowsers } from "@zhiyin/interactive-browser/testing";
import { ConversationRewind, type RewindPlanner } from "@zhiyin/rewind-planner";
import {
  calls,
  documentViewerStub,
  stubDependencies,
  loopFrom,
  type LoopTestDependencies,
  type ModelStep,
  type TestApp,
} from "./support.js";
import { controllableParts, controllableScenes } from "./three-d.js";

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
  const browser = fakeBrowser({
    availability: async () => ({ available: true, browserName: "Test" }),
    state: () => state,
    onState: (listener) => {
      states.add(listener);
      return () => void states.delete(listener);
    },
    markAgentAction: () => actions.forEach((listener) => listener()),
    onAgentAction: (listener) => {
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
    close: async () =>
      publish({ status: "closed", url: "", title: "", loading: false }),
  });
  return {
    browser,
    close: () => browser.close(),
    /** As the agent would: one action, which opens the browser if it is not. */
    async agentActs() {
      browser.markAgentAction();
      if (state.status === "closed") await browser.open();
    },
  };
}

function app(
  options: {
    readonly steps?: readonly ModelStep[];
    readonly midTurn?: () => Promise<void>;
    /** Plans going back; absent, going back is refused. */
    readonly rewind?: RewindPlanner;
  } = {},
) {
  const events: AppEvent[] = [];
  const deps = stubDependencies((event) => events.push(event));
  const browser = controllableBrowser();
  const documents = documentViewerStub();
  const scenes = controllableScenes();
  const parts = controllableParts();
  let taskNumber = 0;
  const midTurn = { midTurn: async () => options.midTurn?.() };
  /** What the model was sent, request by request. */
  const sent: string[] = [];
  const answer = calls(...(options.steps ?? []));
  const loop = loopFrom({
    ...deps,
    ...(options.rewind ? { rewind: options.rewind } : {}),
    newTaskId: () => `task-${++taskNumber}`,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    tools: writingTools(midTurn),
    documents,
    scenes: scenes.port,
    parts: parts.port,
    browsers: fakeBrowsers(() => browser.browser),
    workspace: {
      ...deps.workspace,
      enterFolder: async () => "workspace",
      checkFolder: async () => "workspace",
    },
    model: {
      ...deps.model,
      send: (request) => {
        sent.push(JSON.stringify(request.messages));
        return answer(request);
      },
    },
  } satisfies LoopTestDependencies);
  return { loop, browser, documents, scenes, parts, events, sent };
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

    await loop.surfaces.chooseWorkspaceView(taskId, "conversation");
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
    await loop.surfaces.showDocument(taskId, "q3.pdf");
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

  it("keeps a person's choice while the agent works where they look, and shows what the agent makes elsewhere next", async () => {
    let choose = async () => {};
    const { loop, browser } = app({
      steps: [
        ["write_file", { path: "q3.pdf" }],
        "answer",
        ["think", {}],
        ["write_file", { path: "q4.pdf" }],
        "answer",
      ],
      midTurn: () => choose(),
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the report");
    await browser.agentActs();
    await loop.surfaces.chooseWorkspaceView(taskId, "document");

    // The person picks the browser, and the agent goes on using it.
    let during: string | undefined;
    choose = async () => {
      choose = async () => {};
      await loop.surfaces.chooseWorkspaceView(taskId, "browser");
      await browser.agentActs();
      during = view(loop);
    };
    await loop.start(taskId, "Look it up, then write the next one");

    expect(during).toBe("browser");
    // The document the agent wrote after is new elsewhere, so it is shown.
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("q4.pdf");
  });

  it("keeps the document the person chose when the agent writes another, which joins the list", async () => {
    let choose = async () => {};
    const { loop } = app({
      steps: [
        ["write_file", { path: "q3.pdf" }],
        "answer",
        ["think", {}],
        ["write_file", { path: "q4.pdf" }],
        "answer",
      ],
      midTurn: () => choose(),
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the report");
    choose = async () => {
      choose = async () => {};
      await loop.surfaces.chooseWorkspaceView(taskId, "document");
    };
    await loop.start(taskId, "Write the next one");

    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("q3.pdf");
    expect(loop.snapshot().document?.documents.map((d) => d.path)).toEqual([
      "q4.pdf",
      "q3.pdf",
    ]);
  });

  it("keeps the space put away by the person until the turn ends, whatever the agent makes", async () => {
    let choose = async () => {};
    const { loop } = app({
      steps: [
        ["write_file", { path: "q3.pdf" }],
        "answer",
        ["think", {}],
        ["write_file", { path: "q4.pdf" }],
        "answer",
      ],
      midTurn: () => choose(),
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the report");
    expect(view(loop)).toBe("document");
    choose = async () => {
      choose = async () => {};
      await loop.surfaces.chooseWorkspaceView(taskId, "conversation");
    };
    await loop.start(taskId, "Write the next one");
    expect(view(loop)).toBe("conversation");
  });

  it("ends the person's pick of the browser when the agent closes it, so its first document is shown", async () => {
    let calls = 0;
    let taskId = "";
    const { loop, browser } = app({
      steps: [["think", {}], ["write_file", { path: "report.pdf" }], "answer"],
      midTurn: async () => {
        if (++calls !== 1) return;
        await browser.agentActs();
        await loop.surfaces.chooseWorkspaceView(taskId, "browser");
        await browser.close();
      },
    });
    await loop.selectWorkspace("C:/work");
    taskId = await loop.createTask();
    await loop.start(taskId, "Look it up, then write the report");

    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("report.pdf");
  });

  it("ends the person's pick of the 3D view when Blender stops, so the agent's next document is shown, read and closed as usual", async () => {
    let calls = 0;
    let taskId = "";
    let afterBlenderStopped: string | undefined;
    let afterWrite: string | undefined;
    const { loop, scenes, sent } = app({
      steps: [
        ["write_file", { path: "draft.pdf" }],
        "answer",
        ["think", {}],
        ["write_file", { path: "report.pdf" }],
        ["read_document", { path: "report.pdf" }],
        ["close_document", {}],
        "answer",
      ],
      midTurn: async () => {
        calls++;
        if (calls === 2) {
          scenes.of(taskId).opens("shelf.blend");
          await loop.surfaces.chooseWorkspaceView(taskId, "3d", "scene");
          scenes.of(taskId).stops();
          afterBlenderStopped = shownPath(loop);
        }
        if (calls === 4) afterWrite = shownPath(loop);
      },
    });
    await loop.selectWorkspace("C:/work");
    taskId = await loop.createTask();
    await loop.start(taskId, "Write the draft");
    await loop.start(taskId, "Model it, then write the report");

    expect(afterBlenderStopped).toBe("draft.pdf");
    expect(afterWrite).toBe("report.pdf");
    expect(sent.at(-1)).toContain(
      "Shown to the person beside the conversation, at page 1.",
    );
    expect(sent.at(-1)).toContain(
      "Closed. The person sees the conversation alone.",
    );
    expect(sent.at(-1)).not.toContain("the person chose");
  });

  it("shows a produced file the person opens, and refuses one outside the folder", async () => {
    const { loop } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();

    await expect(
      loop.surfaces.showDocument(taskId, "brief.pdf"),
    ).resolves.toEqual({
      ok: true,
    });
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("brief.pdf");

    await expect(
      loop.surfaces.showDocument(taskId, "../secret.pdf"),
    ).resolves.toEqual({
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

    await expect(
      loop.surfaces.showDocument(taskId, "q3.pdf", 2),
    ).resolves.toEqual({
      ok: true,
    });
    expect(view(loop)).toBe("document");
    expect(loop.snapshot().document).toMatchObject({
      path: "q3.pdf",
      pointed: { page: 2 },
    });

    await expect(
      loop.surfaces.showDocument(taskId, "q3.pdf", 9),
    ).resolves.toEqual({
      ok: false,
      reason: "q3.pdf has 3 pages, so there is no page 9.",
    });
    expect(loop.snapshot().document).toMatchObject({ pointed: { page: 2 } });
  });

  it("gives the space to the open browser when the document closes, or back to the conversation", async () => {
    const { loop, browser } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.surfaces.driveBrowser({ kind: "open" });
    expect(view(loop)).toBe("browser");
    await loop.surfaces.showDocument(taskId, "brief.pdf");
    expect(view(loop)).toBe("document");

    await loop.surfaces.closeDocument(taskId);
    expect(view(loop)).toBe("browser");

    await loop.surfaces.showDocument(taskId, "brief.pdf");
    await browser.close();
    expect(view(loop)).toBe("document");
    await loop.surfaces.closeDocument(taskId);
    expect(view(loop)).toBe("conversation");
  });

  it("refuses a choice of something the conversation does not have open", async () => {
    const { loop } = app();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await expect(
      loop.surfaces.chooseWorkspaceView(taskId, "browser"),
    ).rejects.toThrow("This conversation has no browser open.");
    await expect(
      loop.surfaces.chooseWorkspaceView(taskId, "document"),
    ).rejects.toThrow("This conversation has no document open.");
    expect(view(loop)).toBe("conversation");
  });

  it("shows each conversation's own document and view when switching between them", async () => {
    const { loop, events } = app();
    await loop.selectWorkspace("C:/work");
    const first = await loop.createTask();
    await loop.surfaces.showDocument(first, "first.pdf");
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
    await loop.surfaces.showDocument(taskId, "brief.pdf");
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
    await loop.surfaces.showDocument(taskId, "brief.pdf");
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

    await loop.surfaces.chooseWorkspaceView(taskId, "conversation");
    await loop.start(taskId, "Read the next one");
    expect(shownPath(loop)).toBe("q4.pdf");
    expect(view(loop)).toBe("conversation");
    expect(sent.at(-1)).toContain(
      "Not on screen: the person put the space beside the conversation away. It is there when they open it.",
    );
  });

  it("tells the agent a read is not on screen when the person put the space away during the turn", async () => {
    let choose = async () => {};
    const { loop, sent } = app({
      steps: [
        ["write_file", { path: "q3.pdf" }],
        "answer",
        ["think", {}],
        ["read_document", { path: "q4.pdf" }],
        "answer",
      ],
      midTurn: () => choose(),
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the report");
    choose = async () => {
      choose = async () => {};
      await loop.surfaces.chooseWorkspaceView(taskId, "conversation");
    };
    await loop.start(taskId, "Read the next one");

    expect(view(loop)).toBe("conversation");
    expect(sent.at(-1)).toContain(
      "Not on screen: the person put the space beside the conversation away during this turn. It is there when they open it.",
    );
  });

  it("shows a document the agent reads after the person chose the browser, as something new", async () => {
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
      await loop.surfaces.chooseWorkspaceView(taskId, "browser");
    };
    await loop.start(taskId, "Read the report");

    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("q3.pdf");
    expect(sent.at(-1)).toContain(
      "Shown to the person beside the conversation, at page 1.",
    );
  });

  it("keeps the document the person chose when the agent reads another, which joins the list, and the agent is told so", async () => {
    let choose = async () => {};
    const { loop, sent } = app({
      steps: [
        ["read_document", { path: "q3.pdf" }],
        "answer",
        ["think", {}],
        ["read_document", { path: "q4.pdf" }],
        "answer",
      ],
      midTurn: () => choose(),
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Read the report");
    choose = async () => {
      choose = async () => {};
      await loop.surfaces.chooseWorkspaceView(taskId, "document");
    };
    await loop.start(taskId, "Read the next one");

    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("q3.pdf");
    expect(loop.snapshot().document?.documents.map((d) => d.path)).toEqual([
      "q4.pdf",
      "q3.pdf",
    ]);
    expect(sent.at(-1)).toContain(
      "Not on screen: the person chose to look at q3.pdf during this turn. It stays as they chose; q4.pdf is in the list of this conversation's documents.",
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
    choose = () => loop.surfaces.chooseWorkspaceView(taskId, "document");
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
  function sceneApp(...steps: readonly ModelStep[]) {
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
    expect(view(loop)).toBe("3d");
    expect(loop.snapshot().scene).toMatchObject({
      status: "open",
      file: "shelf.blend",
      working: false,
    });
  });

  it("does not take the space when the person put it away during the turn", async () => {
    const { loop, scenes, during } = sceneApp(["think", {}], "answer");
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(async () => {
      await loop.surfaces.chooseWorkspaceView(taskId, "conversation");
      scenes.of(taskId).opens("shelf.blend");
    });
    await loop.start(taskId, "Model a shelf");
    expect(view(loop)).toBe("conversation");
    expect(loop.snapshot().scene?.status).toBe("open");
  });

  it("takes the space from the browser the person picked, as something new", async () => {
    const { loop, browser, scenes, during } = sceneApp(["think", {}], "answer");
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await browser.agentActs();
    during(async () => {
      await loop.surfaces.chooseWorkspaceView(taskId, "browser");
      scenes.of(taskId).opens("shelf.blend");
    });
    await loop.start(taskId, "Model a shelf");
    expect(view(loop)).toBe("3d");
    expect(loop.snapshot().threeD).toBe("scene");
  });

  it("shows the first parts in place of the browser the person picked, as something new", async () => {
    const { loop, browser, parts, during } = sceneApp(["think", {}], "answer");
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await browser.agentActs();
    during(async () => {
      await loop.surfaces.chooseWorkspaceView(taskId, "browser");
      parts.built(taskId, "Gear");
    });
    await loop.start(taskId, "Make me a gear");
    expect(view(loop)).toBe("3d");
    expect(loop.snapshot().threeD).toBe("parts");
  });

  it("ends the person's pick of the parts once they go, though the scene remains", async () => {
    const { loop, scenes, parts, during } = sceneApp(
      ["write_file", { path: "brief.pdf" }],
      "answer",
      ["think", {}],
      ["write_file", { path: "report.pdf" }],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the brief");
    let whenPartsWent: unknown;
    during(async () => {
      scenes.of(taskId).opens("shelf.blend");
      parts.built(taskId, "Bracket");
      await loop.surfaces.chooseWorkspaceView(taskId, "3d", "parts");
      await parts.port.putAway(taskId);
      whenPartsWent = [view(loop), loop.snapshot().threeD];
      // With the pick ended, the scene closing is the space moving on its own.
      scenes.of(taskId).stops();
    });
    await loop.start(taskId, "Model the shelf and its bracket, then report");

    expect(whenPartsWent).toEqual(["3d", "scene"]);
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("report.pdf");
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
    expect(view(loop)).toBe("3d");

    await loop.surfaces.chooseWorkspaceView(taskId, "conversation");
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
    expect(view(loop)).toBe("3d");

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
    expect(view(loop)).toBe("3d");

    await loop.surfaces.showDocument(taskId, "brief.pdf");
    expect(view(loop)).toBe("document");
    await loop.surfaces.closeDocument(taskId);
    expect(view(loop)).toBe("3d");
  });

  it("refuses the 3D view, and looking at it, in a conversation without a scene", async () => {
    const { loop } = sceneApp();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await expect(
      loop.surfaces.chooseWorkspaceView(taskId, "3d", "scene"),
    ).rejects.toThrow("This conversation has no 3D scene.");
    await expect(loop.surfaces.lookAtScene({ kind: "reset" })).rejects.toThrow(
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
    await loop.surfaces.lookAtScene({ kind: "turn", yaw: 15, pitch: 0 });
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

describe("going back to an earlier message", () => {
  /** Goes back to the conversation's message that says `text`. */
  async function goBack(
    loop: TestApp,
    taskId: string,
    text: string,
    files: "keep" | "restore" = "keep",
  ) {
    const message = loop
      .snapshot()
      .tasks.find((task) => task.id === taskId)
      ?.messages.find((each) => each.text === text);
    if (!message) throw new Error(`No message says ${text}`);
    const preview = await loop.rewinds.preview(taskId, message.id);
    await loop.commitRewind(taskId, preview.id, files);
  }

  const planner = () => new ConversationRewind(() => "rewind-1");

  it("closes a document a removed turn opened", async () => {
    const { loop } = app({
      rewind: planner(),
      steps: ["answer", ["write_file", { path: "reports/q3.pdf" }], "answer"],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Hello");
    await loop.start(taskId, "Write the report");
    expect(shownPath(loop)).toBe("reports/q3.pdf");

    await goBack(loop, taskId, "Write the report");
    expect(shownPath(loop)).toBeUndefined();
    expect(view(loop)).toBe("conversation");
  });

  it("keeps a document the remaining conversation opened, though a removed turn read it again", async () => {
    const { loop } = app({
      rewind: planner(),
      steps: [
        ["write_file", { path: "reports/q3.pdf" }],
        "answer",
        ["read_document", { path: "reports/q3.pdf" }],
        "answer",
      ],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the report");
    await loop.start(taskId, "Check it");

    await goBack(loop, taskId, "Check it");
    expect(shownPath(loop)).toBe("reports/q3.pdf");
    expect(view(loop)).toBe("document");
  });

  it("closes a document a removed turn showed in place of an earlier one", async () => {
    const { loop } = app({
      rewind: planner(),
      steps: [
        ["write_file", { path: "reports/q3.pdf" }],
        "answer",
        ["write_file", { path: "reports/q4.pdf" }],
        "answer",
      ],
    });
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Write the third quarter");
    await loop.start(taskId, "Write the fourth quarter");
    expect(shownPath(loop)).toBe("reports/q4.pdf");

    await goBack(loop, taskId, "Write the fourth quarter");
    expect(shownPath(loop)).toBeUndefined();
  });

  it("opens the space again on the first document written after going back to before any", async () => {
    const { loop } = app({
      rewind: planner(),
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
    await goBack(loop, taskId, "Write the report");
    expect(view(loop)).toBe("conversation");

    await loop.start(taskId, "Write the report");
    expect(view(loop)).toBe("document");
    expect(shownPath(loop)).toBe("reports/q4.pdf");
  });

  it("closes the browser a removed turn opened", async () => {
    let act = async () => {};
    const { loop, browser } = app({
      rewind: planner(),
      steps: ["answer", ["think", {}], "answer"],
      midTurn: () => act(),
    });
    act = () => browser.agentActs();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Hello");
    await loop.start(taskId, "Look it up");
    expect(view(loop)).toBe("browser");

    await goBack(loop, taskId, "Look it up");
    expect(loop.snapshot().browser?.status).toBe("closed");
    expect(view(loop)).toBe("conversation");
  });

  it("keeps the browser the remaining conversation opened", async () => {
    let act = async () => {};
    const { loop, browser } = app({
      rewind: planner(),
      steps: [["think", {}], "answer", ["think", {}], "answer"],
      midTurn: () => act(),
    });
    act = () => browser.agentActs();
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Look it up");
    await loop.start(taskId, "Look again");

    await goBack(loop, taskId, "Look again");
    expect(loop.snapshot().browser?.status).toBe("open");
    expect(view(loop)).toBe("browser");
  });

  /** An app whose agent opens or changes its 3D scene on the calls a test names. */
  function sceneTurns(...steps: readonly ModelStep[]) {
    let act = async () => {};
    const made = app({ rewind: planner(), steps, midTurn: () => act() });
    return {
      ...made,
      during: (next: () => void) => {
        act = async () => {
          act = async () => {};
          next();
        };
      },
    };
  }

  it("puts away a 3D scene a removed turn opened", async () => {
    const { loop, scenes, during } = sceneTurns(
      "answer",
      ["think", {}],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    await loop.start(taskId, "Hello");
    during(() => scenes.of(taskId).opens("shelf.blend"));
    await loop.start(taskId, "Model a shelf");
    expect(view(loop)).toBe("3d");

    await goBack(loop, taskId, "Model a shelf");
    expect(scenes.putAway).toEqual([[taskId, "nothing"]]);
    expect(loop.snapshot().scene?.file).toBeUndefined();
    expect(view(loop)).toBe("conversation");
  });

  it("opens a scene the remaining conversation opened again from its file, once going back put files back", async () => {
    const { loop, scenes, during } = sceneTurns(
      ["think", {}],
      "answer",
      ["think", {}],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => scenes.of(taskId).opens("shelf.blend"));
    await loop.start(taskId, "Model a shelf");
    during(() => scenes.of(taskId).changes());
    await loop.start(taskId, "Make it taller");

    await goBack(loop, taskId, "Make it taller", "restore");
    expect(scenes.putAway).toEqual([[taskId, "file"]]);
    expect(loop.snapshot().scene).toMatchObject({ file: "shelf.blend" });
    expect(loop.snapshot().scene?.preview).toBeUndefined();
  });

  it("leaves a scene the remaining conversation opened as it is when files are kept", async () => {
    const { loop, scenes, during } = sceneTurns(
      ["think", {}],
      "answer",
      ["think", {}],
      "answer",
    );
    await loop.selectWorkspace("C:/work");
    const taskId = await loop.createTask();
    during(() => scenes.of(taskId).opens("shelf.blend"));
    await loop.start(taskId, "Model a shelf");
    during(() => scenes.of(taskId).changes());
    await loop.start(taskId, "Make it taller");

    await goBack(loop, taskId, "Make it taller");
    expect(scenes.putAway).toEqual([]);
    expect(view(loop)).toBe("3d");
  });
});
