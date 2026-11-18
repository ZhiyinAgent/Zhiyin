import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type WorkspaceSnapshot,
} from "@zhiyin/contract";
import {
  besideOf,
  createWindowState,
  listedConversations,
  selectedBeside,
  windowReducer,
} from "./windowState.js";

describe("windowReducer", () => {
  it("keeps the same state when told to show the error already shown, so nothing is drawn again", () => {
    // Every command clears the error first, most often when none is shown.
    const clear = createWindowState({ connection: "ready" });
    const failed = windowReducer(clear, {
      type: "commandErrorShown",
      message: "The folder could not be opened.",
    });

    expect(
      windowReducer(clear, { type: "commandErrorShown", message: "" }),
    ).toBe(clear);
    expect(
      windowReducer(failed, {
        type: "commandErrorShown",
        message: "The folder could not be opened.",
      }),
    ).toBe(failed);
    expect(
      windowReducer(failed, { type: "commandErrorShown", message: "" })
        .commandError,
    ).toBe("");
  });

  it("knows no look until the core says, then the one it saved, or the default", () => {
    const base: WorkspaceSnapshot = {
      runtime: { tasks: "available", capabilities: "available" },
      recentWorkspaces: [],
      selectedTaskId: null,
      tasks: [],
      plugins: [],
      mcpServers: [],
      usage: { status: "unavailable", reason: "No usage yet." },
    };
    const waiting = createWindowState();
    expect(waiting.look).toBeUndefined();

    const told = windowReducer(waiting, {
      type: "windowHydrated",
      snapshot: base,
    });
    expect(told.look).toEqual({ look: "ink", strength: "default" });

    const chosen = windowReducer(told, {
      type: "windowHydrated",
      snapshot: { ...base, look: { look: "neutral", strength: "vivid" } },
    });
    expect(chosen.look).toEqual({ look: "neutral", strength: "vivid" });
  });

  it("keeps a newer history and which conversations wait for an update, as the core said", () => {
    const base: WorkspaceSnapshot = {
      runtime: { tasks: "unavailable", capabilities: "available" },
      recentWorkspaces: [],
      selectedTaskId: null,
      tasks: [],
      plugins: [],
      mcpServers: [],
      usage: { status: "unavailable", reason: "No usage yet." },
    };
    const newer = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot: { ...base, newerHistory: { writtenBy: "0.2.0" } },
    });
    expect(newer.newerHistory).toEqual({ writtenBy: "0.2.0" });

    const waiting = windowReducer(newer, {
      type: "windowHydrated",
      snapshot: {
        ...base,
        runtime: { tasks: "available", capabilities: "available" },
        conversations: [
          {
            id: "trip",
            title: "Trip to Shanghai",
            titleSource: "manual",
            updatedAt: "2026-10-01T09:00:00.000Z",
            updatedLabel: "Last week",
            needsUpdate: { writtenBy: "0.1.0-alpha.1" },
          },
        ],
      },
    });
    expect(waiting.newerHistory).toBeUndefined();
    expect(listedConversations(waiting)).toEqual([
      expect.objectContaining({
        id: "trip",
        needsUpdate: { writtenBy: "0.1.0-alpha.1" },
      }),
    ]);
  });

  it("shows spelling as the core last said it checks it", () => {
    const base: WorkspaceSnapshot = {
      runtime: { tasks: "available", capabilities: "available" },
      recentWorkspaces: [],
      selectedTaskId: null,
      tasks: [],
      plugins: [],
      mcpServers: [],
      usage: { status: "unavailable", reason: "No usage yet." },
    };
    const french = { code: "fr", name: "Français", englishName: "French" };
    const loading = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot: {
        ...base,
        spelling: {
          enabled: true,
          languages: [{ code: "fr", status: "loading" }],
          offered: [french],
        },
      },
    });
    const ready = windowReducer(loading, {
      type: "windowHydrated",
      snapshot: {
        ...base,
        spelling: {
          enabled: true,
          languages: [{ code: "fr", status: "ready" }],
          offered: [french],
        },
      },
    });

    expect(loading.spelling?.languages).toEqual([
      { code: "fr", status: "loading" },
    ]);
    expect(ready.spelling?.languages).toEqual([
      { code: "fr", status: "ready" },
    ]);
  });

  it("shows when long tasks stop to ask as the core last said, the defaults once it says none", () => {
    const base: WorkspaceSnapshot = {
      runtime: { tasks: "available", capabilities: "available" },
      recentWorkspaces: [],
      selectedTaskId: null,
      tasks: [],
      plugins: [],
      mcpServers: [],
      usage: { status: "unavailable", reason: "No usage yet." },
    };
    const set = { rounds: 80, minutes: 45, dollars: 20, yuan: 140 };

    const chosen = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot: { ...base, workPauses: set },
    });
    const reset = windowReducer(chosen, {
      type: "windowHydrated",
      snapshot: base,
    });

    expect(chosen.workPauses).toEqual(set);
    expect(reset.workPauses).toBeUndefined();
  });

  it("reconstructs the visible task from a core snapshot and later events", () => {
    const snapshot: WorkspaceSnapshot = {
      runtime: { tasks: "available", capabilities: "unavailable" },
      recentWorkspaces: [],
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Introduce yourself",
          updatedLabel: "Now",
          titleSource: "generated" as const,
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            {
              sequence: 0,
              id: "user-1",
              role: "user",
              text: "Introduce yourself",
            },
          ],
          actions: [
            {
              sequence: 100,
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

    let state = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot,
    });
    state = windowReducer(state, {
      type: "taskReplaced",
      task: {
        ...snapshot.tasks[0]!,
        messages: [
          ...snapshot.tasks[0]!.messages,
          { sequence: 1, id: "assistant-1", role: "assistant", text: "Hello." },
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

    const state = windowReducer(createWindowState(), {
      type: "taskReplaced",
      task: {
        id: "task-1",
        title: "Long work",
        updatedLabel: "Now",
        titleSource: "generated" as const,
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
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
      titleSource: "generated" as const,
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      compaction: {
        revision: 1,
        throughMessageId: "m9",
        throughEntryId: "entry-m9",
        summary: "Earlier work.",
        retainedActionIds: [],
        createdAt: "2026-09-25T10:00:00.000Z",
      },
      phase: { kind: "interrupted" as const },
    };

    let state = windowReducer(createWindowState(), {
      type: "taskReplaced",
      task,
    });
    expect(state.tasks[0]?.condensedThrough).toBe("m9");

    const { compaction, ...rewound } = task;
    void compaction;
    state = windowReducer(state, { type: "taskReplaced", task: rewound });
    expect(state.tasks[0]?.condensedThrough).toBeUndefined();
  });
});

describe("a conversation's undone turns", () => {
  it("are kept from the core, so each turn can show what its undo did", () => {
    const undos = [
      {
        id: "undo-1",
        messageId: "u1",
        actionIds: ["write-1"],
        at: "2026-10-02T09:00:00.000Z",
        files: [{ path: "notes.md", status: "restored" as const }],
      },
    ];

    const state = windowReducer(createWindowState(), {
      type: "taskReplaced",
      task: {
        id: "task-1",
        title: "Notes",
        updatedLabel: "Now",
        titleSource: "generated" as const,
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
        messages: [],
        undos,
        phase: { kind: "interrupted" },
      },
    });

    expect(state.tasks[0]?.undos).toEqual(undos);
  });
});

describe("the conversation list", () => {
  const opened = {
    id: "open",
    title: "Opened",
    updatedLabel: "Now",
    titleSource: "generated" as const,
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    actions: [],
    phase: { kind: "draft" as const },
  };
  const snapshot: WorkspaceSnapshot = {
    runtime: { tasks: "available", capabilities: "available" },
    recentWorkspaces: [],
    selectedTaskId: "open",
    tasks: [opened],
    conversations: [
      {
        id: "open",
        title: "Opened",
        titleSource: "generated",
        updatedAt: "2026-10-05T09:00:00.000Z",
        updatedLabel: "Now",
      },
      {
        id: "closed",
        title: "Never opened",
        titleSource: "generated",
        updatedAt: "2026-10-04T09:00:00.000Z",
        updatedLabel: "Last week",
      },
    ],
    plugins: [],
    mcpServers: [],
    usage: { status: "unavailable", reason: "No usage yet." },
  };
  const hydrated = () =>
    windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot,
    });

  it("shows every conversation, including ones not opened yet", () => {
    expect(listedConversations(hydrated()).map((item) => item.id)).toEqual([
      "open",
      "closed",
    ]);
  });

  it("shows an opened conversation as it is now, and a new one first", () => {
    let state = windowReducer(hydrated(), {
      type: "taskReplaced",
      task: { ...opened, title: "Renamed" },
    });
    state = windowReducer(state, {
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
    const dated = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot: {
        ...snapshot,
        tasks: [{ ...opened, updatedAt: "2026-09-01T10:00:00.000Z" }],
        conversations: [
          {
            id: "closed",
            title: "Never opened",
            updatedAt: "2026-09-02T10:00:00.000Z",
            updatedLabel: "Earlier",
            titleSource: "generated" as const,
            ...emptyConversationLists,
          },
          {
            id: "open",
            title: "Opened",
            updatedAt: "2026-09-01T10:00:00.000Z",
            updatedLabel: "Earlier",
            titleSource: "generated" as const,
            ...emptyConversationLists,
          },
        ],
      },
    });

    const changed = windowReducer(dated, {
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
    const state = windowReducer(hydrated(), {
      type: "taskRemoved",
      taskId: "closed",
      selectedTaskId: "open",
    });

    expect(listedConversations(state).map((item) => item.id)).toEqual(["open"]);
  });

  it("drops what was reported about a deleted conversation, and nothing else", () => {
    const withIssues = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot: {
        ...snapshot,
        issues: [
          { message: "“Closed” is damaged.", conversationId: "closed" },
          { message: "Plugins could not be loaded." },
        ],
      },
    });

    const state = windowReducer(withIssues, {
      type: "taskRemoved",
      taskId: "closed",
      selectedTaskId: "open",
    });

    expect(state.issues).toEqual([{ message: "Plugins could not be loaded." }]);
  });

  it("keeps each conversation's running commands as the core last announced them", () => {
    const build = {
      id: "J1",
      command: "npm run build",
      explanation: "Builds the app.",
      startedAt: 1_000,
    };
    let state = createWindowState();

    state = windowReducer(state, {
      type: "commandsChanged",
      taskId: "task-1",
      commands: [build],
    });
    state = windowReducer(state, {
      type: "commandsChanged",
      taskId: "task-2",
      commands: [],
    });

    expect(besideOf(state.beside, "task-1").commands).toEqual([build]);
    expect(besideOf(state.beside, "task-2").commands).toEqual([]);
  });
});

describe("a conversation the core changed in one place", () => {
  it("keeps everything else in it the same object, so only what changed is drawn again", () => {
    const task: WorkspaceSnapshot["tasks"][number] = {
      id: "task-1",
      title: "Notes",
      updatedLabel: "Now",
      titleSource: "generated" as const,
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "ask", role: "user", text: "Read the notes." },
        { sequence: 1, id: "answer", role: "assistant", text: "Reading" },
      ],
      actions: [
        {
          sequence: 100,
          id: "read",
          action: "Read a file",
          target: "notes.md",
          status: "completed",
        },
      ],
      views: [
        {
          sequence: 200,
          id: "steps",
          callId: "c1",
          kind: "diagram",
          title: "Steps",
          source: "flowchart LR",
        },
      ],
      phase: { kind: "working", steps: [] },
    };
    const before = windowReducer(createWindowState(), {
      type: "taskReplaced",
      task,
    }).tasks[0]!;

    const after = windowReducer(
      { ...createWindowState(), tasks: [before] },
      {
        type: "taskReplaced",
        task: {
          ...task,
          messages: [
            task.messages[0]!,
            { ...task.messages[1]!, text: "Reading them now" },
          ],
        },
      },
    ).tasks[0]!;

    expect(after.messages[1]?.text).toBe("Reading them now");
    expect(after.messages[0]).toBe(before.messages[0]);
    expect(after.actions?.[0]).toBe(before.actions?.[0]);
    expect(after.views?.[0]).toBe(before.views?.[0]);
  });
});

describe("what is beside each conversation", () => {
  const shown = {
    status: "shown",
    path: "out/q3.pdf",
    name: "q3.pdf",
    folder: "out",
    documents: [{ path: "out/q3.pdf", name: "q3.pdf", folder: "out" }],
    revision: "r1",
    kind: "pdf",
    pages: [{ width: 612, height: 792 }],
    openable: true,
  } as const;
  const snapshot: WorkspaceSnapshot = {
    runtime: { tasks: "available", capabilities: "available" },
    recentWorkspaces: [],
    selectedTaskId: "first",
    tasks: [],
    plugins: [],
    mcpServers: [],
    usage: { status: "unavailable", reason: "No usage yet." },
    document: shown,
    workspaceView: "document",
  };

  it("is the selected conversation's own document and view, as the core last said", () => {
    let state = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot,
    });
    expect(selectedBeside(state).document).toEqual(shown);
    expect(selectedBeside(state).view).toBe("document");

    state = windowReducer(state, {
      type: "workspaceViewChanged",
      taskId: "second",
      view: "browser",
    });
    state = windowReducer(state, {
      type: "selectionReceived",
      taskId: "second",
    });
    expect(selectedBeside(state).document.status).toBe("closed");
    expect(selectedBeside(state).view).toBe("browser");

    state = windowReducer(state, {
      type: "selectionReceived",
      taskId: "first",
    });
    expect(selectedBeside(state).document).toEqual(shown);
    expect(selectedBeside(state).view).toBe("document");
  });

  it("follows the core's announcements for any conversation", () => {
    const closed = { status: "closed", documents: [] } as const;
    let state = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot,
    });
    state = windowReducer(state, {
      type: "documentChanged",
      taskId: "first",
      document: closed,
    });
    state = windowReducer(state, {
      type: "workspaceViewChanged",
      taskId: "first",
      view: "conversation",
    });
    expect(selectedBeside(state).document).toEqual(closed);
    expect(selectedBeside(state).view).toBe("conversation");
  });

  it("is nothing for a new conversation, and forgotten with a deleted one", () => {
    let state = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot,
    });
    state = windowReducer(state, { type: "newTaskStarted" });
    expect(selectedBeside(state).document.status).toBe("closed");
    expect(selectedBeside(state).view).toBe("conversation");

    state = windowReducer(state, {
      type: "taskRemoved",
      taskId: "first",
      selectedTaskId: null,
    });
    expect(state.beside).toEqual({});
  });

  it("forgets the commands a deleted conversation was running", () => {
    let state = windowReducer(createWindowState(), {
      type: "windowHydrated",
      snapshot,
    });
    state = windowReducer(state, {
      type: "commandsChanged",
      taskId: "first",
      commands: [
        {
          id: "J1",
          command: "npm run dev",
          explanation: "Runs the site.",
          startedAt: 0,
        },
      ],
    });

    state = windowReducer(state, {
      type: "taskRemoved",
      taskId: "first",
      selectedTaskId: null,
    });

    expect(state.beside).toEqual({});
  });
});
