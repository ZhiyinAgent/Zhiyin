import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useMemo, useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  emptyConversationLists,
  type BrowserPanelState,
  type CoreApi,
  type DocumentPanelState,
  type PartsPanelState,
} from "@zhiyin/contract";
import {
  createWindowState,
  windowReducer,
  type WindowAction,
  type WindowState,
  type WorkspaceTask,
} from "./windowState.js";
import { WindowShell } from "./WindowShell.js";
import { stubCommands } from "../../stubCommands.js";

describe("beside the conversation", () => {
  it("keeps the conversation and final answer beside the browser with the selector in the header", () => {
    const task = {
      id: "read",
      title: "Read a page",
      titleSource: "generated" as const,
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { id: "u", role: "user" as const, text: "Read this page", sequence: 0 },
      ],
      phase: { kind: "working" as const, steps: [] },
    };
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        tasks: [task],
        selectedTaskId: task.id,
        beside: { [task.id]: { browser: openBrowser("frame") } },
      }),
    );
    const selector = within(
      screen.getByRole("banner", { name: "Task header" }),
    ).getByRole("tab", { name: "Browser" });
    fireEvent.click(selector);
    expect(window.chosen).toHaveBeenLastCalledWith("read", "browser");
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toBeVisible();
    window.send({
      type: "taskReplaced",
      task: {
        ...task,
        messages: [
          ...task.messages,
          {
            sequence: 1,
            id: "a",
            role: "assistant",
            text: "The comparison is ready.",
          },
        ],
        phase: {
          kind: "completed",
          outcome: { title: "Ready", summary: "Done" },
        },
      },
    });
    expect(screen.getByText("The comparison is ready.")).toBeVisible();
    expect(selector).toHaveAttribute("aria-selected", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Return to conversation" }),
    );
    expect(window.chosen).toHaveBeenLastCalledWith("read", "conversation");
    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
  });

  it("offers the 3D view once Blender has a scene to show, not while it is starting, and says Zhiyin is still at work on an empty scene", async () => {
    // The window decodes pictures; jsdom does not.
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: () => Promise.resolve(),
    });
    const task = {
      id: "make",
      title: "Make a bottle",
      titleSource: "generated" as const,
      updatedLabel: "Now",
      updatedAt: "2026-10-10T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { id: "u", role: "user" as const, text: "Make a bottle", sequence: 0 },
      ],
      phase: { kind: "working" as const, steps: [] },
    };
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        tasks: [task],
        selectedTaskId: task.id,
        beside: {
          make: {
            scene: { status: "starting", view: "overview", working: false },
          },
        },
      }),
    );
    // Blender starting has no scene yet: nothing offers one.
    expect(screen.queryByRole("tab", { name: "3D view" })).toBeNull();
    expect(screen.queryByText(/in the 3D view/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Show the 3D view" }),
    ).toBeNull();

    window.send({
      type: "sceneChanged",
      taskId: "make",
      scene: {
        status: "open",
        file: "bottle.blend",
        view: "overview",
        working: true,
      },
    });
    expect(
      screen.getByText("bottle.blend is open in the 3D view."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show the 3D view" }));
    expect(window.chosen).toHaveBeenLastCalledWith("make", "3d");
    expect(
      within(screen.getByRole("complementary", { name: "3D view" })).getByRole(
        "heading",
        { name: "bottle.blend" },
      ),
    ).toBeVisible();

    window.send({
      type: "sceneChanged",
      taskId: "make",
      scene: {
        status: "open",
        file: "bottle.blend",
        view: "overview",
        working: false,
        preview: {
          data: "P1",
          width: 640,
          height: 360,
          view: "overview",
          sequence: 1,
          empty: true,
        },
      },
    });
    await act(async () => {});
    expect(
      screen.getByText("Nothing in the scene yet. Zhiyin is still working."),
    ).toBeVisible();

    window.send({
      type: "taskReplaced",
      task: {
        ...task,
        phase: {
          kind: "completed",
          outcome: { title: "Stopped", summary: "Nothing made" },
        },
      },
    });
    expect(
      screen.getByText("The scene is empty. What Zhiyin makes appears here."),
    ).toBeVisible();
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });

  it("shows task activity and lets the user stop work from the browser workspace", async () => {
    const interruptTask = vi.fn().mockResolvedValue(undefined);
    const task: WorkspaceTask = {
      id: "work",
      title: "Research",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "u", role: "user", text: "Research this page" },
      ],
      phase: { kind: "working", steps: [] },
    };
    const state = createWindowState({
      connection: "ready",
      tasks: [task],
      selectedTaskId: task.id,
      beside: {
        work: {
          browser: {
            status: "open",
            title: "Research",
            url: "https://example.com",
            loading: false,
          },
          view: "browser",
        },
      },
    });
    const { rerender } = render(
      <WindowShell
        state={state}
        dispatch={() => undefined}
        commands={{ ...stubCommands, interruptTask }}
      />,
    );
    expect(screen.getByRole("tab", { name: "Browser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Working")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
    await waitFor(() => expect(interruptTask).toHaveBeenCalledWith("work"));
    rerender(
      <WindowShell
        state={{
          ...state,
          tasks: [{ ...task, phase: { kind: "interrupted" } }],
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    expect(screen.getByText("Task stopped")).toBeVisible();
    expect(
      screen.getByText(
        "You stopped this. Send a message when you want to carry on.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
  });

  it("shows what the core says is beside the conversation, and passes the person's choice to it rather than keeping its own", () => {
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
      }),
    );
    expect(screen.queryByRole("tab", { name: "Browser" })).toBeNull();

    // The core opens the space on the conversation's first browser.
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: openBrowser("first"),
    });
    window.send({
      type: "workspaceViewChanged",
      taskId: "task",
      view: "browser",
    });
    expect(screen.getByRole("tab", { name: "Browser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
    expect(window.chosen).toHaveBeenLastCalledWith("task", "conversation");
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: openBrowser("next"),
    });

    // A new picture of the page is not a new view: only the core says that.
    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("says in the conversation that a browser is open, and opens it from there", () => {
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: { task: { browser: openBrowser("first") } },
      }),
    );

    const notice = screen.getByText("Zhiyin opened a browser.");
    expect(notice).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show the browser" }));

    expect(window.chosen).toHaveBeenLastCalledWith("task", "browser");
    expect(screen.getByRole("tab", { name: "Browser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText("Zhiyin opened a browser.")).toBeNull();
  });

  it("marks the browser's tab while the browser is busy and the conversation is showing", () => {
    besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: {
          task: {
            browser: { ...openBrowser("first"), loading: true },
            view: "browser",
          },
        },
      }),
    );

    // While it is being watched there is nothing to point at.
    expect(screen.getByRole("tab", { name: "Browser" })).not.toHaveAttribute(
      "data-live",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));

    expect(screen.getByRole("tab", { name: "Browser" })).toHaveAttribute(
      "data-live",
      "true",
    );
  });

  it("switches between conversation and live browser without losing the draft or closing the session", () => {
    const driveBrowser = vi.fn();
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: { task: { browser: openBrowser("first") } },
      }),
      { driveBrowser },
    );
    const composer = screen.getByRole("textbox", { name: /message/i });
    fireEvent.change(composer, { target: { value: "Keep my draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "Browser" }));
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toHaveAttribute("src", "data:image/jpeg;base64,first");
    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
    expect(composer).toHaveValue("Keep my draft");
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: openBrowser("next"),
    });
    const conversationTab = screen.getByRole("tab", { name: "Conversation" });
    fireEvent.keyDown(conversationTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Browser" })).toHaveFocus();
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toHaveAttribute("src", "data:image/jpeg;base64,next");
    expect(driveBrowser).not.toHaveBeenCalled();
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: { status: "closed", url: "", title: "", loading: false },
    });
    window.send({
      type: "workspaceViewChanged",
      taskId: "task",
      view: "conversation",
    });
    expect(screen.queryByRole("tab", { name: "Browser" })).toBeNull();
    expect(
      screen.getByRole("log", { name: "Task conversation" }),
    ).toBeVisible();
    expect(composer).toHaveValue("Keep my draft");
    window.send({
      type: "browserChanged",
      taskId: "task",
      browser: openBrowser("first"),
    });
    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens a cited page through the core when the person clicks the citation, and says why when the core refuses", async () => {
    const showDocument = vi.fn(
      async (_task: string, _path: string, page?: number) =>
        page === 24
          ? { ok: true as const }
          : {
              ok: false as const,
              reason: "q3.pdf has 30 pages, so there is no page 99.",
            },
    );
    besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [
          {
            ...draft("task"),
            messages: [
              { sequence: 0, id: "u", role: "user", text: "Which page?" },
              {
                sequence: 1,
                id: "a",
                role: "assistant",
                text: "It is on [page 24](reports/q3.pdf#page=24), not [page 99](reports/q3.pdf#page=99).",
              },
            ],
            phase: {
              kind: "completed",
              outcome: { title: "Answered", summary: "Done" },
            },
          },
        ],
        selectedTaskId: "task",
      }),
      { showDocument },
    );

    fireEvent.click(screen.getByRole("button", { name: /^page 24/ }));
    await waitFor(() =>
      expect(showDocument).toHaveBeenCalledWith("task", "reports/q3.pdf", 24),
    );

    fireEvent.click(screen.getByRole("button", { name: /^page 99/ }));
    expect(
      await screen.findByText("q3.pdf has 30 pages, so there is no page 99."),
    ).toBeVisible();
  });

  it("shows a document beside the conversation, and offers Browser and Document when both are open, closing neither", async () => {
    const closeDocument = vi.fn(async () => undefined);
    const driveBrowser = vi.fn();
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: {
          task: {
            browser: openBrowser("first"),
            document: shownReport,
            view: "document",
          },
        },
      }),
      { closeDocument, driveBrowser },
    );
    expect(screen.getByRole("heading", { name: "q3.pdf" })).toBeVisible();
    const switcher = screen.getByRole("group", {
      name: "Show beside the conversation",
    });
    expect(
      within(switcher).getByRole("button", { name: "Document" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(switcher).getByRole("button", { name: "Browser" }));
    expect(window.chosen).toHaveBeenLastCalledWith("task", "browser");
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "q3.pdf" })).toBeNull();

    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Show beside the conversation" }),
      ).getByRole("button", { name: "Document" }),
    );
    // The browser stays until the document's page is drawn, or said not to be.
    expect(
      await screen.findByRole("heading", { name: "q3.pdf" }),
    ).toBeVisible();
    expect(closeDocument).not.toHaveBeenCalled();
    expect(driveBrowser).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close document" }));
    expect(closeDocument).toHaveBeenCalledWith("task");
  });

  it("keeps the document on screen while the 3D view's picture is decoded, then shows the scene", async () => {
    const decoded: (() => void)[] = [];
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: () => new Promise<void>((resolve) => decoded.push(resolve)),
    });
    try {
      besideConversation(
        createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          tasks: [draft("task")],
          selectedTaskId: "task",
          beside: {
            task: {
              document: shownReport,
              scene: {
                status: "open",
                file: "rooms/desk.blend",
                view: "overview",
                working: false,
                preview: {
                  data: "P1",
                  width: 640,
                  height: 360,
                  view: "overview",
                  sequence: 1,
                },
              },
              view: "document",
            },
          },
        }),
      );
      expect(
        await screen.findByRole("heading", { name: "q3.pdf" }),
      ).toBeVisible();

      fireEvent.click(
        within(
          screen.getByRole("group", { name: "Show beside the conversation" }),
        ).getByRole("button", { name: "3D view" }),
      );
      await act(async () => {});
      expect(screen.getByRole("heading", { name: "q3.pdf" })).toBeVisible();
      expect(screen.queryByRole("heading", { name: "desk.blend" })).toBeNull();

      await act(async () => decoded.forEach((resolve) => resolve()));
      expect(screen.getByRole("heading", { name: "desk.blend" })).toBeVisible();
      expect(screen.queryByRole("heading", { name: "q3.pdf" })).toBeNull();
    } finally {
      delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
    }
  });

  it("says in the conversation which document is beside it, and shows it from there", () => {
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: { task: { document: shownReport, view: "conversation" } },
      }),
    );
    expect(
      screen.getByText("q3.pdf is open beside the conversation."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show the document" }));
    expect(window.chosen).toHaveBeenLastCalledWith("task", "document");
    expect(screen.getByRole("heading", { name: "q3.pdf" })).toBeVisible();
    // The tab names what it shows.
    expect(screen.getByRole("tab", { name: "Document" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("says in the conversation which parts were built beside it, shows them in the 3D view from there, and forgets them once put away", async () => {
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: { task: { view: "conversation" } },
      }),
    );
    window.send({ type: "partsChanged", taskId: "task", parts: gearbox });
    expect(
      screen.getByText("2 parts are built and open in the 3D view."),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Show the 3D view" }));
    expect(window.chosen).toHaveBeenLastCalledWith("task", "3d");
    const view = screen.getByRole("complementary", { name: "3D view" });
    expect(
      within(view).getByRole("heading", { name: "gearbox.py" }),
    ).toBeVisible();
    expect(
      within(view).getByRole("list", { name: "Parts built" }),
    ).toHaveTextContent("Shaft5 × 5 × 40 mm");

    window.send({ type: "partsChanged", taskId: "task", parts: null });
    window.send({
      type: "workspaceViewChanged",
      taskId: "task",
      view: "conversation",
    });
    await act(async () => {});
    expect(screen.queryByRole("complementary", { name: "3D view" })).toBeNull();
    expect(screen.queryByText(/open in the 3D view/)).toBeNull();
  });

  it("shows the scene or the parts in one 3D view, and lets the person pick the other from its menu", () => {
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: {
          task: {
            scene: {
              status: "open",
              file: "rooms/desk.blend",
              view: "overview",
              working: false,
            },
            parts: gearbox,
            view: "3d",
            threeD: "parts",
          },
        },
      }),
    );
    // The scene and the parts are one surface: there is nothing to switch to.
    expect(
      screen.queryByRole("group", { name: "Show beside the conversation" }),
    ).toBeNull();
    const view = screen.getByRole("complementary", { name: "3D view" });
    expect(
      within(view).getByRole("heading", { name: "gearbox.py" }),
    ).toBeVisible();

    fireEvent.click(within(view).getByRole("button", { name: "In 3D" }));
    const menu = within(view).getByRole("list", {
      name: "What the 3D view can show",
    });
    expect(
      within(menu)
        .getAllByRole("button")
        .map((item) => item.textContent),
    ).toEqual(["desk.blendBlender scene", "gearbox.pyParts built"]);
    fireEvent.click(within(menu).getByRole("button", { name: /desk.blend/ }));
    expect(window.chosen).toHaveBeenLastCalledWith("task", "3d", "scene");
    expect(
      within(screen.getByRole("complementary", { name: "3D view" })).getByRole(
        "heading",
        { name: "desk.blend" },
      ),
    ).toBeVisible();
  });

  it("puts the 3D view away from its frame, whichever of the scene and the parts it shows, and keeps both", () => {
    const window = besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: {
          task: {
            scene: {
              status: "open",
              file: "rooms/desk.blend",
              view: "overview",
              working: false,
            },
            parts: gearbox,
            view: "3d",
            threeD: "parts",
          },
        },
      }),
    );
    fireEvent.click(
      within(screen.getByRole("complementary", { name: "3D view" })).getByRole(
        "button",
        { name: "Put the 3D view away" },
      ),
    );
    expect(window.chosen).toHaveBeenLastCalledWith("task", "conversation");
    expect(screen.queryByRole("complementary", { name: "3D view" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "3D view" }));
    fireEvent.click(
      within(screen.getByRole("complementary", { name: "3D view" })).getByRole(
        "button",
        { name: "In 3D" },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /desk.blend/ }));
    const scene = screen.getByRole("complementary", { name: "3D view" });
    expect(
      within(scene).getByRole("heading", { name: "desk.blend" }),
    ).toBeVisible();
    fireEvent.click(
      within(scene).getByRole("button", { name: "Put the 3D view away" }),
    );
    expect(window.chosen).toHaveBeenLastCalledWith("task", "conversation");
    expect(screen.queryByRole("complementary", { name: "3D view" })).toBeNull();
  });

  it("offers neither the switch to the 3D view nor the scene in its menu while Blender is still starting", () => {
    const starting = {
      status: "starting" as const,
      view: "overview" as const,
      working: false,
    };
    const { unmount } = render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          tasks: [draft("task")],
          selectedTaskId: "task",
          beside: {
            task: { document: shownReport, scene: starting, view: "document" },
          },
        })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    expect(screen.getByRole("heading", { name: "q3.pdf" })).toBeVisible();
    expect(
      screen.queryByRole("group", { name: "Show beside the conversation" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "3D view" })).toBeNull();
    unmount();

    besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: {
          task: {
            parts: gearbox,
            scene: starting,
            view: "3d",
            threeD: "parts",
          },
        },
      }),
    );
    const view = screen.getByRole("complementary", { name: "3D view" });
    expect(
      within(view).getByRole("heading", { name: "gearbox.py" }),
    ).toBeVisible();
    // The parts are all the 3D view has to show: no menu offers a scene.
    expect(within(view).queryByRole("button", { name: "In 3D" })).toBeNull();
  });

  it("opens a document in its own app or its folder through the core, for the conversation it belongs to", () => {
    const openDocument = vi.fn(async () => undefined);
    const showDocumentInFolder = vi.fn(async () => undefined);
    besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [draft("task")],
        selectedTaskId: "task",
        beside: { task: { document: shownReport, view: "document" } },
      }),
      { openDocument, showDocumentInFolder },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(openDocument).toHaveBeenCalledWith("task", "out/q3.pdf");
    expect(showDocumentInFolder).toHaveBeenCalledWith("task", "out/q3.pdf");
  });

  it("shows a produced PDF beside the conversation from the files list, and says why when it cannot", async () => {
    const showDocument = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        reason: "out/q3.pdf is outside the folder this conversation works in.",
      });
    besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [
          {
            ...draft("task"),
            artifacts: [
              {
                path: "out/q3.pdf",
                name: "q3.pdf",
                change: "created",
                bytes: 4_000,
                updatedAt: "2026-10-03T09:00:00.000Z",
              },
            ],
          },
        ],
        selectedTaskId: "task",
      }),
      { showDocument },
    );
    const show = () => {
      fireEvent.click(screen.getByRole("button", { name: /^Files/ }));
      fireEvent.click(
        screen.getByRole("button", {
          name: "Show q3.pdf beside the conversation",
        }),
      );
    };
    show();
    await waitFor(() =>
      expect(showDocument).toHaveBeenCalledWith("task", "out/q3.pdf"),
    );
    expect(
      screen.queryByRole("region", { name: "Files this task produced" }),
    ).toBeNull();

    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "out/q3.pdf is outside the folder this conversation works in.",
    );
  });

  it("offers to show beside the conversation a PDF made in its own folder, and not one made in a folder it left", () => {
    const pdf = (name: string, folder: string) => ({
      path: `out/${name}`,
      name,
      change: "created" as const,
      bytes: 4_000,
      updatedAt: "2026-10-03T09:00:00.000Z",
      folder,
    });
    besideConversation(
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [
          {
            ...draft("task"),
            workspace: { path: "C:\\work\\now", name: "now" },
            artifacts: [
              pdf("here.pdf", "C:\\work\\now"),
              pdf("earlier.pdf", "C:\\work\\earlier"),
            ],
          },
        ],
        selectedTaskId: "task",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Files/ }));

    expect(
      screen.getByRole("button", {
        name: "Show here.pdf beside the conversation",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Show earlier.pdf beside the conversation",
      }),
    ).toBeNull();
  });
});

/**
 * The shell over the real reducer, with a core that answers a choice of view
 * the way the real one does: by announcing the view. The window keeps no view
 * of its own, so a test that clicks a tab sees only what the core then says.
 */
function besideConversation(
  initial: WindowState,
  overrides: Partial<CoreApi> = {},
) {
  let dispatchTo!: (action: WindowAction) => void;
  const chosen = vi.fn();
  function Window() {
    const [state, dispatch] = useReducer(windowReducer, initial);
    useEffect(() => {
      dispatchTo = dispatch;
    }, [dispatch]);
    const commands = useMemo<CoreApi>(
      () => ({
        ...stubCommands,
        ...overrides,
        chooseWorkspaceView: async (taskId, view, threeD) => {
          chosen(taskId, view, ...(threeD ? [threeD] : []));
          dispatch({
            type: "workspaceViewChanged",
            taskId,
            view,
            ...(threeD ? { threeD } : {}),
          });
        },
      }),
      [],
    );
    return (
      <WindowShell state={state} dispatch={dispatch} commands={commands} />
    );
  }
  render(<Window />);
  return {
    chosen,
    /** Something the core announced. */
    send: (action: WindowAction) => act(() => dispatchTo(action)),
  };
}

/** Two parts a build made, from a workspace script. */
const gearbox: PartsPanelState = {
  sequence: 3,
  parts: [
    { name: "Gear", size: [30, 30, 10], valid: true },
    { name: "Shaft", size: [5, 5, 40], valid: true },
  ],
  script: "parts/gearbox.py",
};

function draft(id: string): WorkspaceTask {
  return {
    id,
    title: "Report",
    updatedLabel: "Now",
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    phase: { kind: "draft" },
  };
}

function openBrowser(frame: string): BrowserPanelState {
  return {
    status: "open",
    url: "https://example.com",
    title: "Preview",
    loading: false,
    frame: { data: frame, width: 1280, height: 800 },
  };
}

const shownReport: DocumentPanelState = {
  path: "out/q3.pdf",
  name: "q3.pdf",
  folder: "out",
  status: "shown",
  documents: [{ path: "out/q3.pdf", name: "q3.pdf", folder: "out" }],
  revision: "r1",
  kind: "pdf",
  pages: [{ width: 612, height: 792 }],
  openable: true,
};
