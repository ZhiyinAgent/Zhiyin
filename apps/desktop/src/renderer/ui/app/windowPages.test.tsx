import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import { type CoreApi } from "@zhiyin/contract";
import {
  createWindowState,
  windowReducer,
  type WindowState,
} from "./windowState.js";
import { WindowShell } from "./WindowShell.js";
import { stubCommands } from "../../stubCommands.js";
import { Live, failed } from "./test/shell.js";

describe("the pages", () => {
  it.each([
    ["Usage", "Usage"],
    [/^Model:/, "Model"],
    ["Memory", "Memory"],
    ["Settings", "Settings"],
  ])(
    "moves focus to the page it opens from the sidebar: %s",
    async (item, heading) => {
      function Live() {
        const [state, dispatch] = useReducer(
          windowReducer,
          createWindowState({ connection: "ready" }),
        );
        return (
          <WindowShell
            state={state}
            dispatch={dispatch}
            commands={stubCommands}
          />
        );
      }
      render(<Live />);

      const entry = within(
        screen.getByRole("complementary", { name: "Primary navigation" }),
      ).getByRole("button", { name: item });
      entry.focus();
      fireEvent.click(entry);

      expect(
        await screen.findByRole("heading", { level: 1, name: heading }),
      ).toHaveFocus();
    },
  );

  it("closes mobile navigation when the capability library opens", () => {
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
        })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(
      screen.getByRole("button", { name: "Close navigation" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toBeVisible();
  });

  it("sends component switches through the core instead of keeping them local", () => {
    const setComponentEnabled = vi.fn<CoreApi["setComponentEnabled"]>(
      async () => {},
    );
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          surface: "library",
          runtime: { tasks: "available", capabilities: "available" },
          plugins: [
            {
              id: "research",
              name: "Deep Research & Synthesis",
              version: "1.0.0",
              description: "Find and check current facts.",
              category: "Research",
              publisher: "Zhiyin",
              source: "built-in",
              rollbackAvailable: false,
              enabled: true,
              editing: "override",
              status: "ready",
              defaultPrompts: [],
              components: [
                {
                  id: "research/source-triangulation",
                  kind: "skill",
                  name: "source-triangulation",
                  description: "Checks current facts.",
                  enabled: true,
                  status: "ready",
                  editing: "override",
                },
              ],
            },
          ],
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, setComponentEnabled }}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Source triangulation: on" }),
    );

    expect(setComponentEnabled).toHaveBeenCalledWith(
      "research/source-triangulation",
      false,
    );
  });

  it("starts a new conversation from a plugin's prompt, with the prompt in the message and nothing sent", async () => {
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <Live
        initial={createWindowState({
          connection: "ready",
          surface: "library",
          runtime: { tasks: "available", capabilities: "available" },
          plugins: [
            {
              id: "research",
              name: "Deep Research & Synthesis",
              version: "1.0.0",
              description: "Find and check current facts.",
              category: "Research",
              publisher: "Zhiyin",
              source: "built-in",
              rollbackAvailable: false,
              enabled: true,
              editing: "override",
              status: "ready",
              defaultPrompts: [
                "Compare three sources on this question",
                "Check whether this claim still holds",
              ],
              components: [],
            },
          ],
        })}
        commands={{ ...stubCommands, createTask, sendMessage }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Check whether this claim still holds",
      }),
    );

    const message = await screen.findByRole("textbox", { name: /message/i });
    expect(message).toHaveValue("Check whether this claim still holds");
    await waitFor(() => expect(message).toHaveFocus());
    expect(
      screen.queryByRole("region", {
        name: "Deep Research & Synthesis details",
      }),
    ).toBeNull();
    expect(createTask).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("the app's settings", () => {
  it("open from the app menu, and turn notifications off through the core", async () => {
    const setNotifications = vi.fn<CoreApi["setNotifications"]>(
      async () => undefined,
    );
    render(
      <Live
        initial={createWindowState({ connection: "ready" })}
        commands={{ ...stubCommands, setNotifications }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(
      within(screen.getByRole("region", { name: "Settings" })).getByRole(
        "switch",
        { name: "Notifications" },
      ),
    );

    await waitFor(() => expect(setNotifications).toHaveBeenCalledWith(false));
  });

  it("open a conversation from what it cost on the Usage page", async () => {
    const selectTask = vi.fn<CoreApi["selectTask"]>(async () => undefined);
    const range = (days: 7 | 30) => ({
      days,
      requests: 3,
      inputTokens: 30,
      outputTokens: 6,
      costUsd: 0.5,
      pricedRequests: 3,
      activity: [],
      models: [],
      conversations: [
        {
          conversationId: "task-2",
          requests: 3,
          pricedRequests: 3,
          costUsd: 0.5,
        },
      ],
    });
    render(
      <Live
        initial={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            { ...failed().tasks[0]!, id: "task-1", title: "Today" },
            { ...failed().tasks[0]!, id: "task-2", title: "Survey tools" },
          ],
          usage: {
            status: "ready",
            ranges: { "7": range(7), "30": range(30) },
          },
        })}
        commands={{ ...stubCommands, selectTask }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Survey tools" }));

    await waitFor(() => expect(selectTask).toHaveBeenCalledWith("task-2"));
    expect(
      screen.queryByRole("region", { name: "Usage overview" }),
    ).not.toBeInTheDocument();
  });

  it("says so when a conversation chosen on the Usage page cannot be opened", async () => {
    const selectTask = vi.fn<CoreApi["selectTask"]>(async () => {
      throw new Error("That conversation could not be opened.");
    });
    const range = (days: 7 | 30) => ({
      days,
      requests: 3,
      inputTokens: 30,
      outputTokens: 6,
      costUsd: 0.5,
      pricedRequests: 3,
      activity: [],
      models: [],
      conversations: [
        {
          conversationId: "task-2",
          requests: 3,
          pricedRequests: 3,
          costUsd: 0.5,
        },
      ],
    });
    render(
      <Live
        initial={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            { ...failed().tasks[0]!, id: "task-1", title: "Today" },
            { ...failed().tasks[0]!, id: "task-2", title: "Survey tools" },
          ],
          usage: {
            status: "ready",
            ranges: { "7": range(7), "30": range(30) },
          },
        })}
        commands={{ ...stubCommands, selectTask }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Survey tools" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That conversation could not be opened.",
    );
  });

  it("names a conversation on the Usage page that has not been opened since Zhiyin started", () => {
    const range = (days: 7 | 30) => ({
      days,
      requests: 2,
      inputTokens: 20,
      outputTokens: 4,
      costUsd: 0.25,
      pricedRequests: 2,
      activity: [],
      models: [],
      conversations: [
        {
          conversationId: "budget",
          requests: 2,
          pricedRequests: 2,
          costUsd: 0.25,
        },
      ],
    });
    render(
      <Live
        initial={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          conversations: [
            {
              id: "budget",
              title: "Budget 2026",
              titleSource: "generated",
              updatedAt: "2026-10-05T09:00:00.000Z",
              updatedLabel: "9m",
            },
          ],
          usage: {
            status: "ready",
            ranges: { "7": range(7), "30": range(30) },
          },
        })}
        commands={stubCommands}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));

    expect(
      screen.getByRole("button", { name: "Open Budget 2026" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("A deleted conversation"),
    ).not.toBeInTheDocument();
  });

  it("open the data folder through the core, and the sidebar has no evidence page", async () => {
    const openDataFolder = vi.fn<CoreApi["openDataFolder"]>(
      async () => undefined,
    );
    render(
      <Live
        initial={createWindowState({ connection: "ready" })}
        commands={{ ...stubCommands, openDataFolder }}
      />,
    );

    const pages = [
      screen.getByRole("navigation", { name: "App" }),
      screen.getByRole("navigation", { name: "Zhiyin" }),
    ].flatMap((nav) =>
      within(nav)
        .getAllByRole("button")
        .map(
          (button) => button.getAttribute("aria-label") ?? button.textContent,
        ),
    );
    expect(pages).toEqual([
      "Plugins",
      "Memory",
      "Model: none chosen",
      "Usage",
      "Settings",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Open data folder" }));

    await waitFor(() => expect(openDataFolder).toHaveBeenCalledOnce());
  });

  it("choose light or dark through the core, and show the choice saved", async () => {
    const setAppearance = vi.fn<CoreApi["setAppearance"]>(
      async () => undefined,
    );
    render(
      <Live
        initial={{
          ...createWindowState({ connection: "ready" }),
          appearance: "dark",
          surface: "settings",
        }}
        commands={{ ...stubCommands, setAppearance }}
      />,
    );

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Match Windows" }));

    await waitFor(() => expect(setAppearance).toHaveBeenCalledWith("system"));
  });

  it("turn spelling off through the core, keeping the languages it checks", async () => {
    const setSpelling = vi.fn<CoreApi["setSpelling"]>(async () => undefined);
    render(
      <Live
        initial={{
          ...createWindowState({ connection: "ready" }),
          spelling: {
            enabled: true,
            languages: [
              { code: "en-GB", status: "ready" },
              { code: "fr", status: "ready" },
            ],
            offered: [
              {
                code: "en-GB",
                name: "British English",
                englishName: "British English",
              },
              { code: "fr", name: "Français", englishName: "French" },
            ],
          },
          surface: "settings",
        }}
        commands={{ ...stubCommands, setSpelling }}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Check spelling" }));

    await waitFor(() =>
      expect(setSpelling).toHaveBeenCalledWith({
        enabled: false,
        languages: ["en-GB", "fr"],
      }),
    );
  });

  it("show notifications as off when the person turned them off", () => {
    render(
      <WindowShell
        state={{
          ...createWindowState({ connection: "ready" }),
          notifications: "off",
          surface: "settings",
        }}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );

    expect(
      screen.getByRole("switch", { name: "Notifications" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("show when long tasks stop to ask, the defaults until the person sets them, and save a change through the core", async () => {
    const setWorkPauses = vi.fn<CoreApi["setWorkPauses"]>(
      async () => undefined,
    );
    const shell = (workPauses?: WindowState["workPauses"]) => (
      <WindowShell
        state={{
          ...createWindowState({ connection: "ready" }),
          ...(workPauses ? { workPauses } : {}),
          surface: "settings",
        }}
        dispatch={() => undefined}
        commands={{ ...stubCommands, setWorkPauses }}
      />
    );
    const { rerender } = render(shell());
    const rounds = () =>
      screen.getByRole("spinbutton", { name: "Rounds of actions" });
    expect(rounds()).toHaveValue(50);

    const set = { rounds: 80, minutes: 45, dollars: 20, yuan: 140 };
    rerender(shell(set));
    expect(rounds()).toHaveValue(80);
    fireEvent.change(rounds(), { target: { value: "90" } });
    fireEvent.blur(rounds());

    await waitFor(() =>
      expect(setWorkPauses).toHaveBeenCalledWith({ ...set, rounds: 90 }),
    );
  });
});

describe("conversations another version saved", () => {
  const waiting = [
    {
      id: "trip",
      title: "Trip to Shanghai",
      titleSource: "manual" as const,
      updatedAt: "2026-10-01T09:00:00.000Z",
      updatedLabel: "Last week",
      needsUpdate: { writtenBy: "0.1.0-alpha.1" },
    },
  ];

  function shell(
    commands: CoreApi,
    state: Partial<WindowState> = {},
  ): ReturnType<typeof render> {
    return render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          conversations: waiting,
          ...state,
        })}
        dispatch={() => undefined}
        commands={commands}
      />,
    );
  }

  it("asks at launch, and again from the list after Later", async () => {
    const settle = vi.fn(async () => ({ done: 1, failed: 0 }));
    shell({ ...stubCommands, settleSavedConversations: settle });

    const dialog = screen.getByRole("dialog", {
      name: "Update saved conversations",
    });
    expect(dialog).toHaveTextContent(
      "“Trip to Shanghai” was saved by an earlier version of Zhiyin (0.1.0-alpha.1).",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    // Listed as waiting, and its menu leads back to the question.
    const row = screen.getByRole("button", { name: /^Trip to Shanghai/ });
    expect(row).toHaveTextContent("To update");
    fireEvent.click(
      screen.getByRole("button", { name: "Options for Trip to Shanghai" }),
    );
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Update or delete…" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update it" }));
    await waitFor(() => expect(settle).toHaveBeenCalledWith("update"));
  });

  it("asks again from the notice shown in place of a waiting conversation", () => {
    shell(stubCommands, {
      selectedTaskId: "trip",
      issues: [
        {
          message:
            "“Trip to Shanghai” was saved by Zhiyin 0.1.0-alpha.1 and needs an update before it opens.",
          conversationId: "trip",
          canUpdate: true,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Update conversations…" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Update saved conversations" }),
    ).toBeVisible();
  });

  it("asks again from Settings", () => {
    shell(stubCommands, { surface: "settings" });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    fireEvent.click(screen.getByRole("button", { name: "Update or delete…" }));

    expect(
      screen.getByRole("dialog", { name: "Update saved conversations" }),
    ).toBeVisible();
  });

  it("shows the newer-history page in place of the workspace", () => {
    const open = vi.fn(async () => {});
    shell(
      { ...stubCommands, openExternalUrl: open },
      {
        conversations: [],
        runtime: { tasks: "unavailable", capabilities: "available" },
        newerHistory: { writtenBy: "0.2.0" },
      },
    );

    expect(
      screen.getByRole("heading", {
        name: "Your history needs a newer Zhiyin.",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("log", { name: "Task conversation" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Get the latest version" }),
    );
    expect(open).toHaveBeenCalledWith(
      "https://github.com/ZhiyinAgent/Zhiyin/releases",
    );
  });
});
