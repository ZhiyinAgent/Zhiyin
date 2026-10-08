import { describe, expect, it } from "vitest";
import {
  WindowCopy,
  type TaskChange,
  type WorkspaceSnapshot,
  type WorkspaceTask,
} from "../src/index.js";

const task: WorkspaceTask = {
  id: "task-1",
  title: "Notes",
  updatedLabel: "Now",
  messages: [{ id: "m1", role: "assistant", text: "One", sequence: 0 }],
  phase: { kind: "interrupted" },
};

const snapshot: WorkspaceSnapshot = {
  runtime: { tasks: "available", capabilities: "available" },
  tasks: [task],
  selectedTaskId: "task-1",
  plugins: [],
  mcpServers: [],
  usage: { status: "unavailable", reason: "None." },
};

function words(sequence: number, text: string): TaskChange {
  return {
    taskId: "task-1",
    sequence,
    appended: [{ messageId: "m1", text }],
  };
}

function textOf(copy: WindowCopy): string | undefined {
  return copy.snapshot()?.tasks[0]?.messages[0]?.text;
}

describe("the window's copy", () => {
  it("applies changes in order, asks once for a conversation past a missing one, and sets its changes aside until it arrives whole", () => {
    const copy = new WindowCopy();
    copy.receive({ kind: "workspaceSnapshot", data: snapshot });

    copy.receive({ kind: "taskUpdated", data: words(1, " two") });
    expect(textOf(copy)).toBe("One two");

    expect(
      copy.receive({ kind: "taskUpdated", data: words(3, " four") }),
    ).toEqual({ resend: ["task-1"] });
    expect(
      copy.receive({ kind: "taskUpdated", data: words(4, " five") }),
    ).toEqual({ resend: [] });
    expect(textOf(copy)).toBe("One two");

    const whole = {
      ...task,
      messages: [{ ...task.messages[0]!, text: "One two three four five" }],
    };
    copy.receive({ kind: "taskChanged", data: whole });
    copy.receive({ kind: "taskUpdated", data: words(1, " six") });
    expect(textOf(copy)).toBe("One two three four five six");
  });

  it("applies the rest of a workspace change when one conversation's change in it is out of order", () => {
    const copy = new WindowCopy();
    copy.receive({ kind: "workspaceSnapshot", data: snapshot });

    const update = copy.receive({
      kind: "workspaceChanged",
      data: { fields: { appearance: "dark" }, taskChanges: [words(2, " x")] },
    });

    expect(update?.resend).toEqual(["task-1"]);
    expect(update?.snapshot?.appearance).toBe("dark");
    expect(textOf(copy)).toBe("One");
  });
});
