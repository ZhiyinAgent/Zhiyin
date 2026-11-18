import { fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import { emptyConversationLists, type CoreApi } from "@zhiyin/contract";
import {
  createWindowState,
  windowReducer,
  type WorkspaceTask,
} from "./windowState.js";
import { WindowShell } from "./WindowShell.js";
import { stubCommands } from "../../stubCommands.js";

const working: WorkspaceTask = {
  id: "running",
  title: "Sort the invoices",
  updatedLabel: "Now",
  updatedAt: "2026-10-05T09:00:00.000Z",
  ...emptyConversationLists,
  messages: [{ sequence: 0, id: "user", role: "user", text: "Sort them" }],
  phase: {
    kind: "working",
    steps: [{ id: "model", label: "Ask the model", status: "active" }],
  },
};

function shell(task: WorkspaceTask = working) {
  const interruptTask = vi.fn<CoreApi["interruptTask"]>(async () => {});
  function Live() {
    const [state, dispatch] = useReducer(
      windowReducer,
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        tasks: [task],
        selectedTaskId: task.id,
      }),
    );
    return (
      <WindowShell
        state={state}
        dispatch={dispatch}
        commands={{ ...stubCommands, interruptTask }}
      />
    );
  }
  render(<Live />);
  return { interruptTask };
}

describe("the window's keys", () => {
  it("stops the running task on Escape when nothing is open", () => {
    const { interruptTask } = shell();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(interruptTask).toHaveBeenCalledWith("running");
  });

  it("leaves the task running when Escape closes a menu", () => {
    const { interruptTask } = shell();
    fireEvent.click(
      screen.getByRole("button", { name: "Options for Sort the invoices" }),
    );
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(interruptTask).not.toHaveBeenCalled();
  });

  it("leaves a field's own Escape to the field", () => {
    const { interruptTask } = shell();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: /^Sort the invoices/ }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "Rename conversation" });

    fireEvent.keyDown(field, { key: "Escape" });

    expect(interruptTask).not.toHaveBeenCalled();
  });

  it("does nothing on Escape when no task is running", () => {
    const { interruptTask } = shell({
      ...working,
      phase: {
        kind: "completed",
        outcome: { title: "Sorted", summary: "The invoices are sorted." },
      },
    });

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(interruptTask).not.toHaveBeenCalled();
  });

  it("opens Settings with Ctrl+comma", async () => {
    shell();

    fireEvent.keyDown(document.body, { key: ",", ctrlKey: true });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toHaveFocus();
  });
});
