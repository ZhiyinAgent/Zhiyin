/** Projects in the sidebar, holding their conversations (ADR 0026). */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  emptyConversationLists,
  memoryLimits,
  type CoreApi,
  type MemoryState,
} from "@zhiyin/contract";
import { WindowShell } from "./WindowShell.js";
import {
  createWindowState,
  windowReducer,
  type WindowState,
  type WorkspaceTask,
} from "./windowState.js";
import { stubCommands } from "../../stubCommands.js";

const created = "2026-10-01T09:00:00.000Z";
const memory: MemoryState = {
  on: true,
  projects: [
    { id: "thesis", name: "Thesis", folders: ["C:\\Thesis"], created },
    { id: "kitchen", name: "Kitchen", folders: [], created },
    { id: "old", name: "Old project", folders: [], created, archived: true },
  ],
  entries: [],
  waiting: [],
  limits: memoryLimits,
  broadFolders: [],
};

function conversation(
  id: string,
  title: string,
  more: Partial<WorkspaceTask> = {},
): WorkspaceTask {
  return {
    id,
    title,
    updatedLabel: "Now",
    updatedAt: `2026-10-31T09:0${id.length % 10}:00.000Z`,
    ...emptyConversationLists,
    messages: [],
    phase: { kind: "draft" },
    ...more,
  };
}

function workspace(): WindowState {
  return {
    ...createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      tasks: [
        conversation("a", "Chapter 3 figures", {
          workspace: { path: "C:\\Thesis\\figures", name: "figures" },
        }),
        conversation("b", "Quotes for the worktop", {
          project: "kitchen",
          memoryOff: true,
        }),
        conversation("c", "Birthday card"),
        conversation("d", "Thesis notes elsewhere", {
          project: null,
          workspace: { path: "C:\\Thesis", name: "Thesis" },
        }),
        conversation("e", "Before archiving", { project: "old" }),
      ],
      conversations: [
        {
          id: "f",
          title: "Literature review",
          titleSource: "manual",
          updatedAt: "2026-10-20T09:00:00.000Z",
          updatedLabel: "20 Oct",
          project: "thesis",
        },
      ],
    }),
    memory,
  };
}

function Live({ commands }: { commands: CoreApi }) {
  const [state, dispatch] = useReducer(windowReducer, workspace());
  return <WindowShell state={state} dispatch={dispatch} commands={commands} />;
}

const titlesIn = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");

describe("projects in the sidebar", () => {
  it("holds each conversation in its project, chosen or by its folder, opened or not, and the rest under Recent", () => {
    render(<Live commands={stubCommands} />);

    const projects = screen.getByRole("list", { name: "Projects" });
    expect(
      within(projects)
        .getAllByRole("button", { expanded: false })
        .map((row) => row.textContent),
    ).toEqual(["Thesis2", "Kitchen1"]);

    fireEvent.click(
      within(projects).getByRole("button", {
        name: /^Thesis/,
        expanded: false,
      }),
    );
    const thesis = titlesIn(screen.getByRole("list", { name: "Thesis" }));
    expect(thesis.join()).toContain("Chapter 3 figures");
    expect(thesis.join()).toContain("Literature review");
    expect(thesis).toHaveLength(2);

    const recent = screen.getByRole("list", { name: "Recent" });
    expect(recent).toHaveTextContent("Birthday card");
    expect(recent).toHaveTextContent("Thesis notes elsewhere");
    expect(recent).toHaveTextContent("Before archiving");
    expect(screen.queryByText("Old project")).toBeNull();
  });

  it("starts a conversation in a project from its +, in its first linked folder", async () => {
    const useRecentWorkspace = vi.fn<
      NonNullable<CoreApi["useRecentWorkspace"]>
    >(async () => {});
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-new");
    const setConversationMemory = vi.fn<CoreApi["setConversationMemory"]>(
      async () => {},
    );
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <Live
        commands={{
          ...stubCommands,
          useRecentWorkspace,
          createTask,
          setConversationMemory,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "New conversation in Thesis" }),
    );
    expect(useRecentWorkspace).toHaveBeenCalledWith("C:\\Thesis");
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Check the figures" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(setConversationMemory).toHaveBeenCalledWith("task-new", {
      project: "thesis",
    });
    expect(setConversationMemory.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]!,
    );
  });

  it("starts a conversation in a project without folders where the current folder is", async () => {
    const useRecentWorkspace = vi.fn<
      NonNullable<CoreApi["useRecentWorkspace"]>
    >(async () => {});
    const setConversationMemory = vi.fn<CoreApi["setConversationMemory"]>(
      async () => {},
    );
    render(
      <Live
        commands={{
          ...stubCommands,
          useRecentWorkspace,
          createTask: async () => "task-new",
          setConversationMemory,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "New conversation in Kitchen" }),
    );
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Compare the quotes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(setConversationMemory).toHaveBeenCalledWith("task-new", {
        project: "kitchen",
      }),
    );
    expect(useRecentWorkspace).not.toHaveBeenCalled();
  });

  it("starts an ordinary conversation from New conversation after a project's +", async () => {
    const setConversationMemory = vi.fn<CoreApi["setConversationMemory"]>(
      async () => {},
    );
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <Live
        commands={{
          ...stubCommands,
          createTask: async () => "task-new",
          setConversationMemory,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "New conversation in Kitchen" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "A card for Léa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(setConversationMemory).not.toHaveBeenCalled();
  });
});

describe("a conversation's menu", () => {
  function openProject(name: string) {
    fireEvent.click(
      within(screen.getByRole("list", { name: "Projects" })).getByRole(
        "button",
        { name: new RegExp(`^${name}`), expanded: false },
      ),
    );
  }

  function menuOf(title: string) {
    fireEvent.click(
      screen.getByRole("button", { name: `Options for ${title}` }),
    );
    return screen.getByRole("menu");
  }

  it("moves the conversation to a project, or to none, the current one checked", async () => {
    const setConversationMemory = vi.fn<CoreApi["setConversationMemory"]>(
      async () => {},
    );
    render(<Live commands={{ ...stubCommands, setConversationMemory }} />);

    fireEvent.click(
      within(menuOf("Birthday card")).getByRole("menuitem", {
        name: "Move to project…",
      }),
    );
    const choices = screen.getByRole("menu", { name: "Move to project" });
    expect(
      within(choices)
        .getAllByRole("menuitemradio")
        .map((choice) => [
          choice.textContent,
          choice.getAttribute("aria-checked"),
        ]),
    ).toEqual([
      ["Thesis", "false"],
      ["Kitchen", "false"],
      ["No project", "true"],
    ]);
    fireEvent.click(
      within(choices).getByRole("menuitemradio", { name: "Kitchen" }),
    );

    await waitFor(() =>
      expect(setConversationMemory).toHaveBeenCalledWith("c", {
        project: "kitchen",
      }),
    );
    expect(screen.queryByRole("menu")).toBeNull();

    openProject("Thesis");
    fireEvent.click(
      within(menuOf("Chapter 3 figures")).getByRole("menuitem", {
        name: "Move to project…",
      }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No project" }));
    await waitFor(() =>
      expect(setConversationMemory).toHaveBeenCalledWith("a", {
        project: null,
      }),
    );
  });

  it("keeps nothing from the conversation once asked, and says so until asked again", async () => {
    const setConversationMemory = vi.fn<CoreApi["setConversationMemory"]>(
      async () => {},
    );
    render(<Live commands={{ ...stubCommands, setConversationMemory }} />);

    const remembering = within(menuOf("Birthday card")).getByRole(
      "menuitemcheckbox",
      { name: "Don't remember" },
    );
    expect(remembering).toHaveAttribute("aria-checked", "false");
    fireEvent.click(remembering);
    await waitFor(() =>
      expect(setConversationMemory).toHaveBeenCalledWith("c", { off: true }),
    );

    openProject("Kitchen");
    fireEvent.click(
      within(menuOf("Quotes for the worktop")).getByRole("menuitemcheckbox", {
        checked: true,
      }),
    );
    await waitFor(() =>
      expect(setConversationMemory).toHaveBeenCalledWith("b", { off: false }),
    );
  });

  it("offers no move where memory keeps no project", () => {
    function NoProjects() {
      const [state, dispatch] = useReducer(windowReducer, {
        ...workspace(),
        memory: { ...memory, projects: [] },
      });
      return (
        <WindowShell
          state={state}
          dispatch={dispatch}
          commands={stubCommands}
        />
      );
    }
    render(<NoProjects />);

    expect(
      within(menuOf("Birthday card")).queryByRole("menuitem", {
        name: "Move to project…",
      }),
    ).toBeNull();
  });
});
