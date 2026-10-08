/**
 * When Zhiyin asks for the person outside its window. Only while no Zhiyin
 * window has their attention, only for what needs them or a turn long enough
 * to have been left, and in words safe to show on a locked screen.
 */

import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type AppEvent,
  type TaskPhase,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { Attention, type Notice } from "../src/attention.js";

function watched(options: { focused?: boolean; enabled?: boolean } = {}) {
  let now = Date.parse("2026-10-02T09:00:00.000Z");
  const shown: Notice[] = [];
  const opened: string[] = [];
  let focused = options.focused ?? false;
  const attention = new Attention({
    notifier: {
      focused: () => focused,
      notify: (notice) => {
        shown.push(notice);
      },
    },
    now: () => new Date(now),
    enabled: () => options.enabled ?? true,
    open: (taskId) => opened.push(taskId),
  });
  const phase = (kind: TaskPhase, task: Partial<WorkspaceTask> = {}) =>
    attention.observe({
      kind: "taskChanged",
      data: {
        id: "task-1",
        title: "Quarterly report",
        updatedLabel: "Now",
        titleSource: "generated",
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
        messages: [],
        phase: kind,
        ...task,
      },
    } satisfies AppEvent);
  return {
    attention,
    shown,
    opened,
    phase,
    wait: (seconds: number) => {
      now += seconds * 1000;
    },
    focus: (value: boolean) => {
      focused = value;
    },
  };
}

const working: TaskPhase = { kind: "working", steps: [] };
const approval = (id: string, files = 0): TaskPhase => ({
  kind: "approval",
  steps: [],
  prompt: {
    id,
    action: "Write the report",
    target: "secret-plans.md",
    reason: "Changes a file.",
    command: "write_file({...})",
    ...(files
      ? {
          changes: Array.from({ length: files }, (_, index) => ({
            path: `file-${index}.md`,
            change: "updated" as const,
          })),
        }
      : {}),
  },
});
const completed: TaskPhase = {
  kind: "completed",
  outcome: { title: "Done", summary: "The report is written." },
};

describe("a notification outside the window", () => {
  it("is sent when a turn needs an approval and no Zhiyin window is focused, naming only the conversation and the files' count", () => {
    const { phase, shown } = watched();

    phase(working);
    phase(approval("approval-1", 2));

    expect(shown).toEqual([
      {
        taskId: "task-1",
        title: "Quarterly report",
        body: "Needs your approval to change 2 files",
      },
    ]);
  });

  it("is not sent while a Zhiyin window is focused", () => {
    const { phase, shown } = watched({ focused: true });

    phase(working);
    phase(approval("approval-1"));

    expect(shown).toEqual([]);
  });

  it("is not sent again for a second approval within 10 seconds, and is after", () => {
    const { phase, shown, wait } = watched();

    phase(working);
    phase(approval("approval-1"));
    phase(working);
    wait(5);
    phase(approval("approval-2"));
    phase(working);
    wait(11);
    phase(approval("approval-3"));

    expect(shown.map((notice) => notice.body)).toEqual([
      "Needs your approval",
      "Needs your approval",
    ]);
  });

  it("says a question is waiting", () => {
    const { phase, shown } = watched();

    phase(working);
    phase({
      kind: "input",
      steps: [],
      prompt: {
        id: "question-1",
        toolCallId: "call-1",
        request: { kind: "questions", questions: [] },
      } as never,
    });

    expect(shown.map((notice) => notice.body)).toEqual([
      "Has a question for you",
    ]);
  });

  it("is not sent for a turn that finished within 20 seconds, and is for a longer one", () => {
    const { phase, shown, wait } = watched();

    phase(working);
    wait(15);
    phase(completed);
    phase(working);
    wait(25);
    phase(completed);

    expect(shown.map((notice) => notice.body)).toEqual(["Finished"]);
  });

  it("says a turn stopped with an error or before finishing, however short", () => {
    const { phase, shown, wait } = watched();

    phase(working);
    phase({ kind: "failed", reason: "The provider refused." });
    wait(11);
    phase(working);
    phase({ kind: "interrupted" });

    expect(shown.map((notice) => notice.body)).toEqual([
      "Stopped with an error",
      "Stopped before finishing",
    ]);
  });

  it("is not sent for a conversation found as it was left when Zhiyin started", () => {
    const { phase, shown } = watched();

    phase({ kind: "interrupted" });
    phase(approval("approval-1"));

    expect(shown).toEqual([]);
  });

  it("is not sent when the person turned notifications off", () => {
    const { phase, shown } = watched({ enabled: false });

    phase(working);
    phase(approval("approval-1"));

    expect(shown).toEqual([]);
  });
});

describe("clicking a notification", () => {
  it("opens the conversation it was about", () => {
    const opened: string[] = [];
    let open: (() => void) | undefined;
    const attention = new Attention({
      notifier: {
        focused: () => false,
        notify: (_notice, onOpen) => {
          open = onOpen;
        },
      },
      now: () => new Date(),
      enabled: () => true,
      open: (taskId) => opened.push(taskId),
    });
    const task = {
      id: "task-7",
      title: "Trip",
      updatedLabel: "Now",
      titleSource: "generated",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
    };
    attention.observe({
      kind: "taskChanged",
      data: { ...task, phase: working },
    });
    attention.observe({
      kind: "taskChanged",
      data: { ...task, phase: approval("approval-1") },
    });

    open?.();

    expect(opened).toEqual(["task-7"]);
  });
});
