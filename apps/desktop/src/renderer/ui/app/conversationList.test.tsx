import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useMemo, useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import { emptyConversationLists, type CoreApi } from "@zhiyin/contract";
import {
  createWindowState,
  windowReducer,
  type WindowAction,
  type WindowState,
} from "./windowState.js";
import { WindowShell } from "./WindowShell.js";
import { stubCommands } from "../../stubCommands.js";

describe("the conversation list", () => {
  it("keeps Tab inside the open navigation drawer, and gives focus back on Escape", () => {
    render(
      <WindowShell
        state={createWindowState({ connection: "ready" })}
        dispatch={() => undefined}
        commands={stubCommands}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Open navigation" });
    toggle.focus();
    fireEvent.click(toggle);
    const drawer = screen.getByRole("complementary", {
      name: "Primary navigation",
    });
    const last = within(drawer).getByRole("button", { name: "Settings" });
    expect(drawer).toContainElement(last);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(toggle).toHaveFocus();
    fireEvent.keyDown(toggle, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: "Escape" });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAccessibleName("Open navigation");
  });

  it.each(["Permissions", "Export…"])(
    "closes mobile navigation when a conversation's %s dialog opens",
    (item) => {
      render(
        <WindowShell
          state={createWindowState({
            connection: "ready",
            runtime: { tasks: "available", capabilities: "available" },
            tasks: [
              {
                id: "budget",
                title: "Budget 2026",
                updatedAt: "2026-10-05T09:00:00.000Z",
                updatedLabel: "9m",
                ...emptyConversationLists,
                messages: [],
                phase: { kind: "draft" },
              },
            ],
          })}
          dispatch={() => undefined}
          commands={stubCommands}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Options for Budget 2026" }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: item }));

      expect(screen.getByRole("dialog")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Open navigation" }),
      ).toBeVisible();
    },
  );

  it("exports a conversation from its menu in the format the person chooses, and shows where it went", async () => {
    const destination = "C:\\Users\\sam\\Documents\\Budget 2026.json";
    const exportConversation = vi.fn(async () => ({
      status: "saved" as const,
      destination,
    }));
    const showInFolder = vi.fn(async () => {});
    render(
      <WindowShell
        state={createWindowState({
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
        })}
        dispatch={() => undefined}
        commands={{ ...stubCommands, exportConversation, showInFolder }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Options for Budget 2026" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Export…" }));
    const dialog = screen.getByRole("dialog", { name: "Export conversation" });
    expect(within(dialog).getByText("Budget 2026")).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /Data to analyse/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Export…" }));

    expect(await within(dialog).findByText("Saved")).toBeVisible();
    expect(exportConversation).toHaveBeenCalledWith("budget", "trajectory");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show in folder" }),
    );
    expect(showInFolder).toHaveBeenCalledWith(destination);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("deleting a conversation", () => {
    const damaged = () =>
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        conversations: [
          {
            id: "task-9",
            title: "Rapport maternelle",
            titleSource: "generated",
            updatedAt: "2026-10-05T09:00:00.000Z",
            updatedLabel: "9m",
          },
        ],
        selectedTaskId: "task-9",
        issues: [
          {
            message:
              "“Rapport maternelle” is damaged and can't be opened. Your other conversations are unaffected.",
            conversationId: "task-9",
            canDelete: true,
          },
        ],
      });

    it("shows a damaged conversation's report in its place, without suggestions or a composer", () => {
      render(
        <WindowShell
          state={damaged()}
          dispatch={() => undefined}
          commands={stubCommands}
        />,
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "“Rapport maternelle” is damaged and can't be opened.",
      );
      expect(screen.queryByText("What should we work on?")).toBeNull();
      expect(screen.getByLabelText("Message Zhiyin")).not.toBeVisible();
    });

    it("replaces one conversation's report with the next one's", () => {
      const state = damaged();
      const both = {
        ...state,
        conversations: [
          ...(state.conversations ?? []),
          {
            id: "task-8",
            title: "Budget 2026",
            titleSource: "generated" as const,
            updatedAt: "2026-10-05T09:00:00.000Z",
            updatedLabel: "9m",
          },
        ],
        issues: [
          ...(state.issues ?? []),
          {
            message:
              "“Budget 2026” is damaged and can't be opened. Your other conversations are unaffected.",
            conversationId: "task-8",
            canDelete: true as const,
          },
        ],
      };
      const { rerender } = render(
        <WindowShell
          state={both}
          dispatch={() => undefined}
          commands={stubCommands}
        />,
      );
      expect(screen.getAllByRole("alert")).toHaveLength(1);

      rerender(
        <WindowShell
          state={{ ...both, selectedTaskId: "task-8" }}
          dispatch={() => undefined}
          commands={stubCommands}
        />,
      );

      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent("“Budget 2026”");
    });

    it("says the conversation was deleted once the core has deleted it", async () => {
      const deleteTask = vi.fn<CoreApi["deleteTask"]>(async () => {});
      render(
        <WindowShell
          state={damaged()}
          dispatch={() => undefined}
          commands={{ ...stubCommands, deleteTask }}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Delete conversation" }),
      );
      expect(deleteTask).not.toHaveBeenCalled();
      fireEvent.click(
        within(
          screen.getByRole("group", { name: "Delete this conversation?" }),
        ).getByRole("button", { name: "Delete conversation" }),
      );

      expect(deleteTask).toHaveBeenCalledWith("task-9");
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "Deleted “Rapport maternelle”.",
        ),
      );
    });

    it("says nothing was deleted when the core could not delete it", async () => {
      const dispatch = vi.fn();
      render(
        <WindowShell
          state={damaged()}
          dispatch={dispatch}
          commands={{
            ...stubCommands,
            deleteTask: async () => {
              throw new Error("The conversation could not be deleted.");
            },
          }}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Delete conversation" }),
      );
      fireEvent.click(
        within(
          screen.getByRole("group", { name: "Delete this conversation?" }),
        ).getByRole("button", { name: "Delete conversation" }),
      );

      await waitFor(() =>
        expect(dispatch).toHaveBeenCalledWith({
          type: "commandErrorShown",
          message: "The conversation could not be deleted.",
        }),
      );
      expect(screen.queryByText(/Deleted “/)).toBeNull();
    });
  });
});

describe("the conversation list", () => {
  const trip = {
    id: "trip",
    title: "Trip to Shanghai",
    titleSource: "manual" as const,
    updatedAt: "2026-10-01T09:00:00.000Z",
    updatedLabel: "Last week",
  };
  const opened = {
    ...trip,
    ...emptyConversationLists,
    messages: [],
    phase: { kind: "draft" as const },
  };

  /**
   * The shell over the real reducer, listing one conversation the core has not
   * opened yet. `core` is handed what the core announces through.
   */
  function listing(
    core: (announce: (action: WindowAction) => void) => Partial<CoreApi>,
    initial: Partial<WindowState> = {},
  ) {
    function Window() {
      const [state, dispatch] = useReducer(
        windowReducer,
        createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          conversations: [trip],
          ...initial,
        }),
      );
      const commands = useMemo<CoreApi>(
        () => ({ ...stubCommands, ...core(dispatch) }),
        [],
      );
      return (
        <WindowShell state={state} dispatch={dispatch} commands={commands} />
      );
    }
    return render(<Window />);
  }

  function openMenu() {
    fireEvent.click(
      screen.getByRole("button", { name: "Options for Trip to Shanghai" }),
    );
  }

  it("says why the core refused a new name, and takes no longer a name than it accepts", async () => {
    listing(() => ({
      renameTask: async () => {
        throw new Error(
          "This request is invalid. Reopen the page and try again.",
        );
      },
    }));

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "Rename conversation" });
    expect(field).toHaveAttribute("maxLength", "160");
    fireEvent.change(field, { target: { value: "Trip to Beijing" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This request is invalid. Reopen the page and try again.",
    );
  });

  it("gives focus back to a conversation's options button on Escape, and leaves the navigation drawer open", () => {
    listing(() => ({}));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    openMenu();
    screen.getByRole("menuitem", { name: "Rename" }).focus();

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Rename" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Options for Trip to Shanghai" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Close navigation" }),
    ).toBeVisible();

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Options for Trip to Shanghai" }),
      { key: "Escape" },
    );
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveFocus();
  });

  it("gives focus back to a conversation's row on Escape when the menu was opened from the row", () => {
    listing(() => ({}));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const row = screen.getByRole("button", { name: /^Trip to Shanghai/ });
    row.focus();
    // The context-menu key, or a right click.
    fireEvent.contextMenu(row);
    screen.getByRole("menuitem", { name: "Rename" }).focus();

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Rename" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(row).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Close navigation" }),
    ).toBeVisible();
  });

  it("asks the core to open a conversation that is only listed, and shows its permissions once it has, without going to it", async () => {
    const other = { ...opened, id: "notes", title: "Notes" };
    const asked = vi.fn();
    const select = vi.fn();
    listing(
      (announce) => ({
        openTask: async (id) => {
          asked(id);
          announce({ type: "taskReplaced", task: opened });
        },
        selectTask: async (id) => select(id),
      }),
      { tasks: [other], selectedTaskId: "notes" },
    );

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Permissions" }));

    const dialog = await screen.findByRole("dialog", { name: "Permissions" });
    expect(dialog).toHaveTextContent("Trip to Shanghai");
    expect(dialog).toHaveTextContent(
      "No active permissions for this conversation.",
    );
    expect(asked).toHaveBeenCalledWith("trip");
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Notes/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows no permissions later, unasked, for a conversation the core could not open", async () => {
    let announce!: (action: WindowAction) => void;
    listing((to) => {
      announce = to;
      return {
        openTask: async () => {
          throw new Error("This conversation could not be opened.");
        },
      };
    });

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Permissions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This conversation could not be opened.",
    );

    act(() => announce({ type: "taskReplaced", task: opened }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows no permissions later, unasked, once the person has gone to another conversation", async () => {
    const other = { ...opened, id: "notes", title: "Notes" };
    let finish!: () => void;
    let announce!: (action: WindowAction) => void;
    listing(
      (to) => {
        announce = to;
        return {
          openTask: () => new Promise<void>((resolve) => (finish = resolve)),
        };
      },
      { tasks: [other], selectedTaskId: "notes" },
    );

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Permissions" }));
    act(() => announce({ type: "selectionReceived", taskId: null }));
    act(() => announce({ type: "selectionReceived", taskId: "notes" }));

    await act(async () => {
      announce({ type: "taskReplaced", task: opened });
      finish();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
