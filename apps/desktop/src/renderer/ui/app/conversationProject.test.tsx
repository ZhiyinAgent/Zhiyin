/** A conversation's project, as its header shows and changes it (ADR 0026). */

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
  type WorkspaceTask,
} from "./windowState.js";
import { stubCommands } from "../../stubCommands.js";

const created = "2026-10-01T09:00:00.000Z";
const memory: MemoryState = {
  on: true,
  projects: [
    { id: "thesis", name: "Thesis", folders: ["C:\\Thesis"], created },
    { id: "kitchen", name: "Kitchen", folders: [], created },
  ],
  entries: [],
  waiting: [],
  limits: memoryLimits,
  broadFolders: ["C:\\Users\\Lea\\Documents"],
};

function opened(more: Partial<WorkspaceTask>): WorkspaceTask {
  return {
    id: "task-1",
    title: "Garden plan",
    updatedLabel: "Now",
    updatedAt: "2026-10-31T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    phase: { kind: "draft" },
    ...more,
  };
}

function Live({ task, commands }: { task: WorkspaceTask; commands: CoreApi }) {
  const [state, dispatch] = useReducer(windowReducer, {
    ...createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      tasks: [task],
      selectedTaskId: task.id,
    }),
    memory,
  });
  return <WindowShell state={state} dispatch={dispatch} commands={commands} />;
}

const header = () => screen.getByRole("banner", { name: "Task header" });
const openPicker = () => {
  fireEvent.click(within(header()).getByRole("button", { name: /^Project:/ }));
  return screen.getByRole("menu", { name: "Project" });
};

describe("a conversation's project in its header", () => {
  it("shows the project the conversation is in, by its folder or chosen, or No project", () => {
    const { unmount } = render(
      <Live
        task={opened({ workspace: { path: "C:\\Thesis\\data", name: "data" } })}
        commands={stubCommands}
      />,
    );
    expect(
      within(header()).getByRole("button", { name: "Project: Thesis" }),
    ).toBeVisible();
    unmount();

    render(<Live task={opened({})} commands={stubCommands} />);
    expect(
      within(header()).getByRole("button", { name: "Project: No project" }),
    ).toBeVisible();
  });

  it("puts the conversation in a project, or in none, the current one checked", async () => {
    const setConversationMemory = vi.fn<CoreApi["setConversationMemory"]>(
      async () => {},
    );
    render(
      <Live
        task={opened({ project: "kitchen" })}
        commands={{ ...stubCommands, setConversationMemory }}
      />,
    );

    const menu = openPicker();
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => [item.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([
      ["Thesis", "false"],
      ["Kitchen", "true"],
      ["No project", "false"],
    ]);
    fireEvent.click(
      within(menu).getByRole("menuitemradio", { name: "No project" }),
    );

    await waitFor(() =>
      expect(setConversationMemory).toHaveBeenCalledWith("task-1", {
        project: null,
      }),
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on the project chosen now, and moves through the projects with the arrow keys", () => {
    render(
      <Live task={opened({ project: "kitchen" })} commands={stubCommands} />,
    );

    const menu = openPicker();
    const item = (name: string) =>
      within(menu).getByRole("menuitemradio", { name });
    expect(document.activeElement).toBe(item("Kitchen"));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("No project"));
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Thesis"));
  });

  it("asks whether to link a folder no project holds, and does as the person answers", async () => {
    const setConversationMemory = vi.fn<CoreApi["setConversationMemory"]>(
      async () => {},
    );
    render(
      <Live
        task={opened({ workspace: { path: "C:\\Garden", name: "Garden" } })}
        commands={{ ...stubCommands, setConversationMemory }}
      />,
    );

    fireEvent.click(
      within(openPicker()).getByRole("menuitemradio", { name: "Kitchen" }),
    );
    const question = screen.getByRole("group", { name: "Link the folder?" });
    expect(question).toHaveTextContent(
      "Link Garden to Kitchen too, so later conversations there join it by themselves?",
    );
    fireEvent.click(
      within(question).getByRole("button", { name: "Link the folder too" }),
    );
    await waitFor(() =>
      expect(setConversationMemory).toHaveBeenCalledWith("task-1", {
        project: "kitchen",
        linkFolder: true,
      }),
    );

    fireEvent.click(
      within(openPicker()).getByRole("menuitemradio", { name: "Kitchen" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Only this conversation" }),
    );
    await waitFor(() =>
      expect(setConversationMemory).toHaveBeenLastCalledWith("task-1", {
        project: "kitchen",
      }),
    );
  });

  it("asks nothing for a folder where work of every kind passes", async () => {
    const setConversationMemory = vi.fn<CoreApi["setConversationMemory"]>(
      async () => {},
    );
    render(
      <Live
        task={opened({
          workspace: { path: "C:\\Users\\Lea\\Documents", name: "Documents" },
        })}
        commands={{ ...stubCommands, setConversationMemory }}
      />,
    );

    fireEvent.click(
      within(openPicker()).getByRole("menuitemradio", { name: "Kitchen" }),
    );

    expect(
      screen.queryByRole("group", { name: "Link the folder?" }),
    ).toBeNull();
    await waitFor(() =>
      expect(setConversationMemory).toHaveBeenCalledWith("task-1", {
        project: "kitchen",
      }),
    );
  });

  it("makes a project from the conversation's folder, and says why when memory refuses", async () => {
    const changeMemory = vi.fn<CoreApi["changeMemory"]>(async () => ({
      ok: false,
      reason: "A project is already called Garden.",
    }));
    render(
      <Live
        task={opened({ workspace: { path: "C:\\Garden", name: "Garden" } })}
        commands={{ ...stubCommands, changeMemory }}
      />,
    );

    fireEvent.click(
      within(openPicker()).getByRole("menuitem", {
        name: "New project from this conversation",
      }),
    );

    expect(changeMemory).toHaveBeenCalledWith({
      kind: "projectFromConversation",
      taskId: "task-1",
    });
    expect(
      await screen.findByText("A project is already called Garden."),
    ).toBeVisible();
  });

  it("closes on Escape from inside the menu, back on its button", () => {
    render(<Live task={opened({})} commands={stubCommands} />);

    const menu = openPicker();
    const kitchen = within(menu).getByRole("menuitemradio", {
      name: "Kitchen",
    });
    kitchen.focus();
    fireEvent.keyDown(kitchen, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      within(header()).getByRole("button", { name: /^Project:/ }),
    ).toHaveFocus();
  });

  it("offers no new project to a conversation without a folder", () => {
    render(<Live task={opened({})} commands={stubCommands} />);

    expect(
      within(openPicker()).queryByRole("menuitem", {
        name: "New project from this conversation",
      }),
    ).toBeNull();
  });
});
