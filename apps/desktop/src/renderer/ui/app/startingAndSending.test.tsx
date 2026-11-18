import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  emptyConversationLists,
  memoryLimits,
  type CoreApi,
  type MessageAttachment,
  type PasteOutcome,
  type WorkspaceTask as CoreWorkspaceTask,
} from "@zhiyin/contract";
import {
  createWindowState,
  windowReducer,
  type WindowState,
  type WorkspaceTask,
} from "./windowState.js";
import { WindowShell } from "./WindowShell.js";
import { stubCommands } from "../../stubCommands.js";

describe("starting a conversation and sending to it", () => {
  it("asks the core for the answer now, for the conversation whose model is reasoning", async () => {
    const answerNow = vi.fn().mockResolvedValue(true);
    const task: WorkspaceTask = {
      id: "reasoning",
      title: "Phone stand",
      updatedLabel: "Now",
      updatedAt: "2026-10-13T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "u", role: "user", text: "Design a phone stand" },
        {
          sequence: 1,
          id: "a",
          role: "assistant",
          text: "",
          reasoning: {
            text: "A wedge, or a folded sheet.",
            status: "streaming",
          },
        },
      ],
      phase: { kind: "working", steps: [], note: "Thinking" },
    };
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          tasks: [task],
          selectedTaskId: task.id,
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, answerNow }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Answer now" }));

    await waitFor(() => expect(answerNow).toHaveBeenCalledWith("reasoning"));
  });

  it("has a waiting message sent now, or taken back, in the conversation it waits in", async () => {
    const sendNow = vi.fn().mockResolvedValue(true);
    const takeBackMessage = vi.fn().mockResolvedValue(undefined);
    const task: WorkspaceTask = {
      id: "reasoning",
      title: "Phone stand",
      updatedLabel: "Now",
      updatedAt: "2026-10-14T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "u", role: "user", text: "Design a phone stand" },
        {
          sequence: 1,
          id: "a",
          role: "assistant",
          text: "",
          reasoning: {
            text: "A wedge, or a folded sheet.",
            status: "streaming",
          },
        },
      ],
      guidance: [
        { id: "g1", text: "Keep it to one flat base", status: "pending" },
      ],
      phase: { kind: "working", steps: [], note: "Thinking" },
    };
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          tasks: [task],
          selectedTaskId: task.id,
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, sendNow, takeBackMessage }}
      />,
    );
    const waiting = screen.getByRole("group", {
      name: "Message waiting to be read",
    });
    expect(waiting).toHaveTextContent("Keep it to one flat base");

    fireEvent.click(within(waiting).getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(sendNow).toHaveBeenCalledWith("reasoning"));
    fireEvent.click(within(waiting).getByRole("button", { name: "Take back" }));
    await waitFor(() =>
      expect(takeBackMessage).toHaveBeenCalledWith("reasoning", "g1"),
    );
  });

  it("shows the paste and the picture a waiting message carries, and puts both back in the message box once it is taken back", async () => {
    const carried: MessageAttachment[] = [
      { kind: "pastedText", id: "paste-1", bytes: 1200, lines: 40 },
      {
        kind: "picture",
        id: "shot-1",
        name: "pasted-1.png",
        mediaType: "image/png",
        bytes: 5000,
        // Claimed into the conversation as the message was sent.
        source: "pasted-pictures/reasoning/shot-1",
      },
    ];
    const conversation = (status: "pending" | "draft"): WorkspaceTask => ({
      id: "reasoning",
      title: "Phone stand",
      updatedLabel: "Now",
      updatedAt: "2026-10-14T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "u", role: "user", text: "Design a phone stand" },
      ],
      guidance: [
        {
          id: "g1",
          text: "Compare it with this",
          status,
          attachments: carried,
        },
      ],
      phase:
        status === "pending"
          ? { kind: "working", steps: [], note: "Thinking" }
          : { kind: "interrupted" },
    });
    const shell = (task: WorkspaceTask) => (
      <WindowShell
        state={createWindowState({
          connection: "ready",
          tasks: [task],
          selectedTaskId: task.id,
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          readPicture: async () => ({
            status: "ready" as const,
            mediaType: "image/png",
            data: "iVBORw0KGgo=",
          }),
        }}
      />
    );
    const { rerender } = render(shell(conversation("pending")));
    const waiting = screen.getByRole("group", {
      name: "Message waiting to be read",
    });
    expect(
      within(waiting).getByRole("button", { name: "Open pasted text paste-1" }),
    ).toBeInTheDocument();
    expect(
      await within(waiting).findByRole("button", {
        name: "Open picture pasted-1.png",
      }),
    ).toBeInTheDocument();

    // Taken back, it is a draft: its words and what it carried are in the box.
    rerender(shell(conversation("draft")));

    expect(
      screen.queryByRole("group", { name: "Message waiting to be read" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /message/i })).toHaveValue(
      "Compare it with this",
    );
    expect(
      screen.getByRole("button", { name: "Remove pasted text" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove picture pasted-1.png" }),
    ).toBeInTheDocument();
  });

  it("shows reasoning only while it arrives, and passes the selected effort to the core", async () => {
    const task: WorkspaceTask = {
      id: "reasoning",
      title: "Research",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "u", role: "user", text: "Research this" },
        {
          sequence: 1,
          id: "r",
          role: "assistant",
          text: "",
          reasoning: { text: "Comparing sources.", status: "streaming" },
        },
      ],
      phase: { kind: "working", steps: [] },
    };
    const state = createWindowState({
      connection: "ready",
      selectedTaskId: task.id,
      tasks: [task],
      runtime: { tasks: "available", capabilities: "available" },
      provider: {
        ...createWindowState().provider,
        reasoning: {
          status: "available",
          required: true,
          defaultEnabled: true,
          defaultEffort: "max",
          efforts: ["max", "high", "low"],
        },
      },
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <WindowShell
        state={state}
        dispatch={() => {}}
        commands={{ ...stubCommands, sendMessage: send }}
      />,
    );
    expect(screen.getAllByLabelText("Zhiyin response")).toHaveLength(1);
    expect(screen.getByText("Comparing sources.")).toBeVisible();
    expect(screen.getByText("Working")).toBeVisible();
    rerender(
      <WindowShell
        state={{
          ...state,
          tasks: [
            {
              ...task,
              phase: { kind: "interrupted" },
              messages: [
                task.messages[0]!,
                {
                  ...task.messages[1]!,
                  reasoning: {
                    text: "Comparing sources.",
                    status: "interrupted",
                  },
                },
              ],
            },
          ],
        }}
        dispatch={() => {}}
        commands={{ ...stubCommands, sendMessage: send }}
      />,
    );
    expect(screen.queryByText("Comparing sources.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Reasoning settings"));
    fireEvent.change(screen.getByLabelText("Reasoning effort"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Continue" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(task.id, "Continue", {
        enabled: true,
        effort: "low",
      }),
    );
  });

  it("leaves a picture to the core while the model's details cannot be looked up, rather than saying it cannot see", async () => {
    const keepPicture = vi.fn(async (): Promise<PasteOutcome> => ({
      status: "refused",
      reason:
        "Whether this model can see pictures is not known yet: its details could not be loaded. Try again in a moment.",
    }));
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          provider: {
            ...createWindowState().provider,
            acceptsImages: false,
            lookupFailed: true,
          },
        })}
        dispatch={() => {}}
        commands={{ ...stubCommands, keepPicture }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Attach pictures" }),
    ).toBeEnabled();
    fireEvent.paste(screen.getByLabelText("Message Zhiyin"), {
      clipboardData: {
        files: [
          new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
            type: "image/png",
          }),
        ],
        getData: () => "",
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("not known yet");
    expect(keepPicture).toHaveBeenCalled();
  });

  it("leaves a picture to the core before the core has said what the model accepts", async () => {
    const keepPicture = vi.fn(async (): Promise<PasteOutcome> => ({
      status: "refused",
      reason:
        "Whether this model can see pictures is not known yet: its details could not be loaded. Try again in a moment.",
    }));
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
        })}
        dispatch={() => {}}
        commands={{ ...stubCommands, keepPicture }}
      />,
    );

    fireEvent.paste(screen.getByLabelText("Message Zhiyin"), {
      clipboardData: {
        files: [
          new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
            type: "image/png",
          }),
        ],
        getData: () => "",
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("not known yet");
    expect(keepPicture).toHaveBeenCalled();
  });

  it("puts the default budget back, and says so, when it cannot be saved", async () => {
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          contextBudget: "medium",
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          setDefaultContextBudget: () =>
            Promise.reject(new Error("settings unwritable")),
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^Conversation room:/ }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /^Low/ }));

    expect(
      await screen.findByText(
        "The budget could not be saved, so it stays as it was.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: /^Medium/ })).toBeChecked();
  });

  it("tells the core when a conversation is left for a new one", () => {
    const selectNothing = vi.fn(async () => {});
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            {
              id: "task-1",
              title: "Earlier work",
              updatedLabel: "Now",
              updatedAt: "2026-10-05T09:00:00.000Z",
              ...emptyConversationLists,
              messages: [
                { sequence: 0, id: "m1", role: "user", text: "Hello" },
              ],
              phase: {
                kind: "completed",
                outcome: { title: "Done", summary: "Finished." },
              },
            },
          ],
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, selectNothing }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));

    expect(selectNothing).toHaveBeenCalled();
  });

  it("uses content-shaped placeholders while the workspace loads, and only for what the window has", () => {
    render(
      <WindowShell
        state={createWindowState({ connection: "loading" })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Loading workspace" }),
    ).toBeVisible();
    expect(
      screen.getByRole("status", { name: "Loading current task" }),
    ).toBeVisible();
    // The window has no shelf beside the conversation to stand in for.
    expect(
      screen.queryByRole("status", { name: "Loading session context" }),
    ).toBeNull();
    expect(screen.queryByText(/connecting to the core/i)).toBeNull();
  });

  it("sends a long paste by the name it was kept as, and opens it from the message after", async () => {
    const paste = {
      kind: "pastedText" as const,
      id: "pasted-2026-09-24-101500.txt",
      bytes: 48_000,
      lines: 1_200,
    };
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    const openAttachment = vi.fn<CoreApi["openAttachment"]>(async () => {});
    const commands = {
      ...stubCommands,
      createTask: async () => "task-new",
      sendMessage,
      openAttachment,
      keepPaste: async () => ({ status: "kept" as const, attachment: paste }),
    };
    const { rerender } = render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
        })}
        dispatch={() => undefined}
        commands={commands}
      />,
    );

    fireEvent.paste(screen.getByLabelText("Message Zhiyin"), {
      clipboardData: { getData: () => "x".repeat(15_000) },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /Open pasted text/ }),
    );
    expect(openAttachment).toHaveBeenLastCalledWith(null, paste.id);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith("task-new", "", undefined, [
        paste.id,
      ]),
    );

    const task: WorkspaceTask = {
      id: "task-new",
      title: "Pasted text",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [
        { sequence: 0, id: "u", role: "user", text: "", attachments: [paste] },
      ],
      phase: { kind: "working", steps: [] },
    };
    rerender(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          tasks: [task],
          selectedTaskId: task.id,
        })}
        dispatch={() => undefined}
        commands={commands}
      />,
    );
    fireEvent.click(
      within(screen.getByRole("log", { name: "Task conversation" })).getByRole(
        "button",
        { name: /Open pasted text/ },
      ),
    );
    expect(openAttachment).toHaveBeenLastCalledWith("task-new", paste.id);
  });

  it("creates a new task and submits its first message", async () => {
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, createTask, sendMessage }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Review the recent changes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "task-new",
        "Review the recent changes",
        undefined,
      ),
    );
  });

  it("sends a first message to the conversation it made, and stays on the one the person opened meanwhile", async () => {
    const ready = {
      connection: "ready" as const,
      runtime: {
        tasks: "available" as const,
        capabilities: "available" as const,
      },
    };
    const conversation = (id: string, title: string): WorkspaceTask => ({
      id,
      title,
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      phase: { kind: "draft" },
    });
    const earlier = conversation("task-old", "Budget review");
    const made = conversation("task-new", "Trip");
    let answer: (id: string) => void = () => undefined;
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    const selectTask = vi.fn<CoreApi["selectTask"]>(async () => {});
    const dispatch = vi.fn();
    type Show = (state: ReturnType<typeof createWindowState>) => void;
    let show: Show = () => undefined;
    function Opening({ shows }: { readonly shows: (set: Show) => void }) {
      const [state, setState] = useState(
        createWindowState({ ...ready, tasks: [earlier] }),
      );
      useEffect(() => shows(setState), [shows]);
      const commands = useMemo(
        () => ({
          ...stubCommands,
          createTask: () =>
            new Promise<string>((resolve) => (answer = resolve)),
          sendMessage,
          selectTask,
        }),
        [],
      );
      return (
        <WindowShell state={state} dispatch={dispatch} commands={commands} />
      );
    }
    render(<Opening shows={(set) => (show = set)} />);
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Plan a trip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    // The person opens the earlier conversation before the new one is made.
    act(() =>
      show(
        createWindowState({
          ...ready,
          tasks: [earlier],
          selectedTaskId: earlier.id,
        }),
      ),
    );
    act(() => {
      show(
        createWindowState({
          ...ready,
          tasks: [made, earlier],
          selectedTaskId: earlier.id,
        }),
      );
      answer(made.id);
    });

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "task-new",
        "Plan a trip",
        undefined,
      ),
    );
    expect(
      screen.getByRole("button", { name: /^Budget review/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /^Trip/ })).not.toHaveAttribute(
      "aria-current",
    );
    // Nor does the window ask to move there.
    expect(selectTask).not.toHaveBeenCalledWith("task-new");
    expect(JSON.stringify(dispatch.mock.calls)).not.toContain("task-new");
  });

  /**
   * The core opens a new conversation before it says it made it, so the
   * window shows that conversation while its first message is still being
   * sent. A send that fails there leaves the words where they were typed.
   */

  it("keeps a new conversation's first message in the composer when it could not be sent", async () => {
    const ready = {
      connection: "ready" as const,
      runtime: {
        tasks: "available" as const,
        capabilities: "available" as const,
      },
    };
    const draft: WorkspaceTask = {
      id: "task-new",
      title: "New task",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      phase: { kind: "draft" },
    };
    function Opening() {
      const [state, setState] = useState(createWindowState(ready));
      const commands = useMemo(
        () => ({
          ...stubCommands,
          createTask: async () => {
            setState(
              createWindowState({
                ...ready,
                tasks: [draft],
                selectedTaskId: draft.id,
              }),
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
            return draft.id;
          },
          sendMessage: async () => {
            throw new Error("Choose a model before sending.");
          },
        }),
        [],
      );
      return (
        <WindowShell
          state={state}
          dispatch={() => undefined}
          commands={commands}
        />
      );
    }
    render(<Opening />);

    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Plan a trip to Xi'an" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByText(/Your message could not be sent/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message Zhiyin")).toHaveValue(
      "Plan a trip to Xi'an",
    );
  });

  it("leaves the next empty composer empty once the conversation its first message opened is deleted", async () => {
    const ready = {
      connection: "ready" as const,
      runtime: {
        tasks: "available" as const,
        capabilities: "available" as const,
      },
    };
    const opened: WorkspaceTask = {
      id: "task-new",
      title: "Trip",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      phase: { kind: "draft" },
    };
    type Show = (state: ReturnType<typeof createWindowState>) => void;
    let show: Show = () => undefined;
    function Opening({ shows }: { readonly shows: (set: Show) => void }) {
      const [state, setState] = useState(createWindowState(ready));
      useEffect(() => shows(setState), [shows]);
      const commands = useMemo(
        () => ({
          ...stubCommands,
          createTask: async () => {
            setState(
              createWindowState({
                ...ready,
                tasks: [opened],
                selectedTaskId: opened.id,
              }),
            );
            return opened.id;
          },
          sendMessage: async () => {
            setState(
              createWindowState({
                ...ready,
                tasks: [
                  {
                    ...opened,
                    messages: [
                      {
                        sequence: 0,
                        id: "u",
                        role: "user",
                        text: "Plan a trip",
                      },
                    ],
                    phase: { kind: "interrupted" },
                  },
                ],
                selectedTaskId: opened.id,
              }),
            );
          },
        }),
        [],
      );
      return (
        <WindowShell
          state={state}
          dispatch={() => undefined}
          commands={commands}
        />
      );
    }
    render(<Opening shows={(set) => (show = set)} />);
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Plan a trip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Message Zhiyin")).toHaveValue(""),
    );
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "A draft for the trip" },
    });

    // Deleted, and it was the only one: nothing is open.
    act(() => show(createWindowState({ ...ready, tasks: [] })));

    expect(screen.getByLabelText("Message Zhiyin")).toHaveValue("");
  });

  it("shows how full the conversation is and sends a budget change to the core", () => {
    const setContextBudget = vi.fn<CoreApi["setContextBudget"]>(async () => {});
    const task: WorkspaceTask = {
      id: "measured",
      title: "Measured",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [{ sequence: 0, id: "u", role: "user", text: "Look" }],
      phase: { kind: "interrupted" },
      contextBudget: "ultra",
      contextUsage: {
        model: "wide",
        totalTokens: 425_000,
        measured: true,
        parts: {
          instructions: 1_000,
          tools: 4_000,
          summary: 0,
          conversation: 400_000,
          toolResults: 20_000,
        },
      },
    };
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          selectedTaskId: task.id,
          tasks: [task],
          runtime: { tasks: "available", capabilities: "available" },
          contextBudget: "low",
          provider: {
            ...createWindowState().provider,
            contextWindow: 1_000_000,
          },
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, setContextBudget }}
      />,
    );

    // The conversation's own choice wins over the app's default.
    const ring = screen.getByRole("button", { name: /^Conversation room/ });
    expect(ring).toHaveAccessibleName("Conversation room: 50% used");
    fireEvent.click(ring);
    fireEvent.click(screen.getByRole("radio", { name: /Medium/ }));

    expect(setContextBudget).toHaveBeenCalledWith("measured", "medium");
  });

  it("shows in the conversation and on its ring that the core is compacting it, until it says it has finished", () => {
    const task: CoreWorkspaceTask = {
      id: "long",
      title: "Long",
      titleSource: "manual",
      updatedLabel: "Now",
      updatedAt: "2026-10-07T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [{ sequence: 0, id: "u", role: "user", text: "Look" }],
      phase: { kind: "completed", outcome: { title: "Done", summary: "" } },
    };
    const hydrated = (
      compacting?: readonly { taskId: string; since: string }[],
    ) =>
      windowReducer(createWindowState(), {
        type: "windowHydrated",
        snapshot: {
          runtime: { tasks: "available", capabilities: "available" },
          recentWorkspaces: [],
          selectedTaskId: task.id,
          tasks: [task],
          plugins: [],
          mcpServers: [],
          usage: { status: "unavailable", reason: "No usage yet." },
          ...(compacting ? { compacting } : {}),
        },
      });
    const shown = (state: WindowState) => (
      <WindowShell
        state={{ ...state, connection: "ready" }}
        dispatch={() => undefined}
        commands={stubCommands}
      />
    );

    // Begun two minutes ago, as the core says.
    const since = new Date(Date.now() - 120_000).toISOString();
    const { rerender } = render(shown(hydrated([{ taskId: task.id, since }])));
    expect(
      screen.getByText(/^Compacting the earlier conversation/),
    ).toHaveTextContent("Compacting the earlier conversation2 min");
    expect(
      screen.getByRole("button", { name: /^Conversation room/ }),
    ).toHaveAttribute("aria-busy", "true");

    rerender(shown(hydrated()));
    expect(
      screen.queryByText(/^Compacting the earlier conversation/),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Conversation room/ }),
    ).not.toHaveAttribute("aria-busy");
  });

  it("keeps the person's own instructions in Memory, and the ring's breakdown leads there", async () => {
    const changeMemory = vi.fn<CoreApi["changeMemory"]>(async () => ({
      ok: true,
    }));
    const dispatch = vi.fn();
    const task: WorkspaceTask = {
      id: "task-1",
      title: "Reports",
      updatedLabel: "now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      phase: { kind: "interrupted" },
      contextUsage: {
        model: "wide",
        totalTokens: 10_000,
        measured: true,
        parts: {
          instructions: 1_000,
          tools: 1_000,
          summary: 0,
          conversation: 8_000,
          toolResults: 0,
        },
      },
      standingInstructions: [
        {
          source: "how",
          text: "Always answer in French.",
          bytes: 24,
          truncated: false,
        },
      ],
    };
    const { rerender } = render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          tasks: [task],
          selectedTaskId: "task-1",
        })}
        dispatch={dispatch}
        commands={{ ...stubCommands, changeMemory }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Conversation room/ }));
    fireEvent.click(screen.getByRole("button", { name: "What's using space" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit in Memory" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "surfaceOpened",
      surface: "memory",
    });

    rerender(
      <WindowShell
        state={{
          ...createWindowState({
            connection: "ready",
            runtime: { tasks: "available", capabilities: "available" },
            surface: "memory",
          }),
          memory: {
            on: true,
            projects: [],
            entries: [
              {
                number: 1,
                scope: "everything",
                section: "how",
                title: "How to work",
                summary: "",
                text: "Always answer in French.",
                written: "2026-10-05T09:00:00.000Z",
              },
            ],
            waiting: [],
            limits: memoryLimits,
            broadFolders: [],
          },
        }}
        dispatch={dispatch}
        commands={{ ...stubCommands, changeMemory }}
      />,
    );
    expect(screen.getByText("Always answer in French.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit How to work" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
      target: { value: "Answer in German." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(changeMemory).toHaveBeenCalledWith({
        kind: "edit",
        number: 1,
        edit: { title: "How to work", summary: "", text: "Answer in German." },
      }),
    );
  });

  it("makes a budget chosen before the first message the default, and fixes it on the conversation that message starts", async () => {
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const setContextBudget = vi.fn<CoreApi["setContextBudget"]>(async () => {});
    const setDefaultContextBudget = vi.fn<CoreApi["setDefaultContextBudget"]>(
      async () => {},
    );
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          provider: {
            ...createWindowState().provider,
            contextWindow: 1_000_000,
          },
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          createTask,
          setContextBudget,
          setDefaultContextBudget,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Conversation room/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Low/ }));
    expect(setDefaultContextBudget).toHaveBeenCalledWith("low");
    expect(createTask).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Low/ })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Start" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(setContextBudget).toHaveBeenCalledWith("task-new", "low");
    expect(setContextBudget.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]!,
    );
  });

  it("starts a new conversation on the default, fixed on it so a later default leaves it alone", async () => {
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const setContextBudget = vi.fn<CoreApi["setContextBudget"]>(async () => {});
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          contextBudget: "ultra",
          provider: {
            ...createWindowState().provider,
            contextWindow: 1_000_000,
          },
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          createTask,
          setContextBudget,
          sendMessage,
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Start" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(setContextBudget).toHaveBeenCalledWith("task-new", "ultra");
  });

  it("changes only the open conversation when its budget is chosen, never the default", () => {
    const setContextBudget = vi.fn<CoreApi["setContextBudget"]>(async () => {});
    const setDefaultContextBudget = vi.fn<CoreApi["setDefaultContextBudget"]>(
      async () => {},
    );
    const other: WorkspaceTask = {
      id: "other",
      title: "Other",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [{ sequence: 0, id: "u", role: "user", text: "Hi" }],
      phase: { kind: "interrupted" },
    };
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          selectedTaskId: other.id,
          tasks: [other],
          runtime: { tasks: "available", capabilities: "available" },
          provider: {
            ...createWindowState().provider,
            contextWindow: 1_000_000,
          },
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          setContextBudget,
          setDefaultContextBudget,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Conversation room/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Ultra/ }));

    expect(setContextBudget).toHaveBeenCalledWith("other", "ultra");
    expect(setDefaultContextBudget).not.toHaveBeenCalled();
  });

  it("keeps a new conversation ephemeral until the first message is sent", async () => {
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
        })}
        dispatch={() => undefined}
        commands={{
          createTask,
          selectTask: async () => {},
          openTask: async () => {},
          renameTask: async () => {},
          deleteTask: async () => {},
          sendMessage,
          keepPaste: async () => ({
            status: "refused",
            reason: "Not kept here.",
          }),
          openAttachment: async () => {},
          setContextBudget: async () => {},
          setDefaultContextBudget: async () => {},
          changeMemory: async () => ({ ok: true }),
          setConversationMemory: async () => {},
          condenseNow: async () => {},
          interruptTask: async () => {},
          answerNow: async () => false,
          sendNow: async () => false,
          takeBackMessage: async () => {},
          runningCommands: async () => [],
          commandOutput: async () => undefined,
          stopCommand: async () => {},
          resolveApproval: async () => {},
          revokeConversationPermission: async () => {},
          resolveUserInput: async () => {},
          setComponentEnabled: async () => {},
          componentContent: async () => undefined,
          overrideComponent: async () => {},
          resetComponent: async () => {},
          installToolchain: async () => {},
          cancelToolchainInstall: async () => {},
          setPluginEnabled: async () => {},
          installPlugin: async () => ({ status: "cancelled" as const }),
          updatePlugin: async () => ({ status: "cancelled" as const }),
          rollbackPlugin: async () => {},
          removePlugin: async () => {},
          createPlugin: async () => {},
          savePluginContents: async () => {},
          editablePluginContents: async () => undefined,
          setMcpServerToolEnabled: async () => {},
          testMcpConnection: async () => ({
            ok: false,
            reason: "Not configured.",
          }),
          saveMcpServerToken: async () => {},
          clearMcpServerToken: async () => {},
          signInToMcpServer: async () => ({ status: "cancelled" }),
          cancelMcpSignIn: async () => {},
          refreshConnections: async () => {},
          checkMcpConnection: async () => {
            throw new Error("Not configured.");
          },
          shellAvailability: async () => ({ available: true }),
          recheckShell: async () => ({ available: true }),
          openExternalUrl: async () => {},
          openAnswerLink: async () => {},
          driveBrowser: async () => {},
          watchBrowser: async () => {},
          lookAtScene: async () => {},
          partModel: async () => undefined,
          chooseWorkspaceView: async () => {},
          showDocument: async () => ({ ok: true as const }),
          closeDocument: async () => {},
          drawDocumentPage: async () => ({
            ok: false as const,
            reason: "Not drawn here.",
          }),
          openDocument: async () => {},
          showDocumentInFolder: async () => {},
          saveProviderApiKey: async () => ({ status: "accepted" as const }),
          clearProviderApiKey: async () => {},
          listProviders: async () => [],
          listModels: async () => ({ status: "ready", models: [] }),
          listModelProviders: async () => ({
            status: "unavailable",
            reason: "not in this test",
          }),
          selectModel: async () => {},
          modelList: stubCommands.modelList,
          checkModelList: stubCommands.checkModelList,
          setModelListUpdates: stubCommands.setModelListUpdates,
          previewArtifact: async () => ({
            status: "missing" as const,
            path: "",
            reason: "Not available in this test.",
          }),
          exportArtifact: async () => ({ status: "cancelled" as const }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(createTask).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Review the project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledWith(
      "task-new",
      "Review the project",
      undefined,
    );
  });

  it("puts the folder picker in the composer and locks it during a decision", () => {
    const withPhase = (phase: WorkspaceTask["phase"]) =>
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        workspace: { path: "C:/work/reports", name: "reports" },
        recentWorkspaces: [
          { path: "C:/work/reports", name: "reports" },
          { path: "C:/work/notes", name: "notes" },
        ],
        selectedTaskId: "task",
        tasks: [
          {
            id: "task",
            title: "Look at the reports",
            updatedLabel: "Now",
            updatedAt: "2026-10-05T09:00:00.000Z",
            ...emptyConversationLists,
            messages: [
              { sequence: 0, id: "user", role: "user", text: "Look at these" },
            ],
            phase,
          },
        ],
      });

    const { rerender } = render(
      <WindowShell
        state={withPhase({
          kind: "completed",
          outcome: { title: "Done", summary: "Looked." },
        })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    const picker = screen.getByRole("button", { name: /^Folder:/ });
    const composer = screen.getByLabelText("Message Zhiyin").closest("form");
    expect(composer?.contains(picker)).toBe(true);
    expect(picker).toBeEnabled();

    rerender(
      <WindowShell
        state={withPhase({
          kind: "approval",
          steps: [],
          prompt: {
            id: "call-1",
            action: "Read project manifest",
            target: "package.json",
            reason: "Identify the project.",
            command: 'read_file({"path":"package.json"})',
          },
        })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(screen.getByRole("button", { name: /^Folder:/ })).toBeDisabled();
  });

  it("locks the folder picker while a command the conversation started still runs", () => {
    const state = createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      workspace: { path: "C:/work/reports", name: "reports" },
      selectedTaskId: "task",
      tasks: [
        {
          id: "task",
          title: "Build the site",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [],
          phase: {
            kind: "completed",
            outcome: { title: "Done", summary: "Started." },
          },
        },
      ],
      beside: {
        task: {
          commands: [
            {
              id: "J1",
              command: "npm run build",
              explanation: "Builds the site.",
              startedAt: 0,
            },
          ],
        },
      },
    });

    render(
      <WindowShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(screen.getByRole("button", { name: /^Folder:/ })).toBeDisabled();
  });

  it("locks the folder picker while a specialist the conversation started still works", () => {
    const state = createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      workspace: { path: "C:/work/reports", name: "reports" },
      selectedTaskId: "task",
      tasks: [
        {
          id: "task",
          title: "Check the reports",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [],
          specialistRuns: [
            {
              sequence: 1,
              id: "run-1",
              specialist: {
                id: "fact-checker",
                name: "Fact-checker",
                description: "Fact-checker.",
                instructions: "Check.",
                provenance: { source: "plugin", pluginId: "research" },
              },
              task: "Check every figure.",
              depth: 1,
              status: "running",
              startedAt: "2026-10-05T09:00:00.000Z",
              actionIds: [],
            },
          ],
          phase: {
            kind: "completed",
            outcome: { title: "Waiting", summary: "Waiting on a specialist." },
            backgroundSpecialistIds: ["run-1"],
          },
        },
      ],
    });

    render(
      <WindowShell
        state={state}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(screen.getByRole("button", { name: /^Folder:/ })).toBeDisabled();
  });

  it("shows the shown conversation's running commands in its header, and lets the person stop one", async () => {
    const stopCommand = vi.fn<CoreApi["stopCommand"]>(async () => {});
    const build = {
      id: "J1",
      command: "npm run build",
      explanation: "Builds the app.",
      startedAt: Date.now(),
    };
    const state = createWindowState({
      connection: "ready",
      selectedTaskId: "work",
      runtime: { tasks: "available", capabilities: "available" },
      tasks: [
        {
          id: "work",
          title: "Build it",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [{ sequence: 0, id: "user", role: "user", text: "Build" }],
          phase: { kind: "draft" },
        },
      ],
      beside: {
        work: { commands: [build] },
        other: { commands: [build, build] },
      },
    });

    render(
      <WindowShell
        state={state}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          runningCommands: async () => [build],
          stopCommand,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1 command running" }));
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Running commands" }),
      ).getByRole("button", { name: "Stop npm run build" }),
    );
    await waitFor(() => expect(stopCommand).toHaveBeenCalledWith("work", "J1"));
  });

  it("prevents the composer from starting an overlapping turn", () => {
    const interruptTask = vi.fn<CoreApi["interruptTask"]>(async () => {});
    const state = createWindowState({
      connection: "ready",
      selectedTaskId: "running",
      runtime: { tasks: "available", capabilities: "available" },
      tasks: [
        {
          id: "running",
          title: "Current task",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            { sequence: 0, id: "user", role: "user", text: "Keep working" },
          ],
          phase: {
            kind: "working",
            steps: [{ id: "model", label: "Ask the model", status: "active" }],
          },
        },
      ],
    });

    render(
      <WindowShell
        state={state}
        dispatch={() => undefined}
        commands={{ ...stubCommands, interruptTask }}
      />,
    );

    expect(screen.getByLabelText("Message Zhiyin")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
    expect(interruptTask).toHaveBeenCalledWith("running");
  });
});
