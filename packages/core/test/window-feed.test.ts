/**
 * Each kind of change a conversation can go through, sent as a change and
 * applied by the window's own copy, leaves the window holding the conversation
 * as it is.
 */

import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  WindowCopy,
  type AppEvent,
  type WorkspaceSnapshot,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { WindowFeed } from "../src/window-feed.js";

const task: WorkspaceTask = {
  id: "task-1",
  title: "Notes",
  updatedLabel: "Now",
  titleSource: "generated",
  updatedAt: "2026-10-05T09:00:00.000Z",
  ...emptyConversationLists,
  contextBudget: "standard",
  messages: [
    { id: "m1", role: "user", text: "Read the notes.", sequence: 0 },
    {
      id: "m2",
      role: "assistant",
      text: "Reading",
      reasoning: { text: "The notes are", status: "streaming" },
      sequence: 2,
    },
  ],
  actions: [
    {
      id: "a1",
      action: "Read a file",
      target: "notes.md",
      status: "running",
      sequence: 1,
    },
  ],
  views: [],
  phase: { kind: "working", steps: [] },
};

function workspace(tasks: readonly WorkspaceTask[]): WorkspaceSnapshot {
  return {
    runtime: { tasks: "available", capabilities: "available" },
    tasks,
    selectedTaskId: tasks[0]?.id ?? null,
    plugins: [],
    mcpServers: [],
    usage: { status: "unavailable", reason: "None." },
  };
}

/** Sends `from` whole, then `to` as a change; what the window holds after. */
function sentAsChange(from: WorkspaceTask, to: WorkspaceTask) {
  const feed = new WindowFeed();
  const copy = new WindowCopy();
  const sent: AppEvent[] = [];
  for (const event of [
    { kind: "workspaceSnapshot", data: workspace([from]) },
    { kind: "taskChanged", data: to },
  ] satisfies AppEvent[]) {
    const translated = feed.translate(event);
    if (translated) {
      sent.push(translated);
      copy.receive(translated);
    }
  }
  return { held: copy.snapshot()?.tasks[0], last: sent.at(-1) };
}

describe("a conversation sent as what changed in it", () => {
  it("adds words to a message's text and reasoning without sending the message again", () => {
    const m2 = task.messages[1]!;
    const to = {
      ...task,
      messages: [
        task.messages[0]!,
        {
          ...m2,
          text: "Reading them now",
          reasoning: { text: "The notes are short", status: "streaming" },
        },
      ],
    } satisfies WorkspaceTask;
    const { held, last } = sentAsChange(task, to);
    expect(held).toEqual(to);
    expect(last).toEqual({
      kind: "taskUpdated",
      data: {
        taskId: "task-1",
        sequence: 1,
        appended: [{ messageId: "m2", text: " them now", reasoning: " short" }],
      },
    });
  });

  it("sends a message whole when what changed is not words added at the end", () => {
    const to = {
      ...task,
      messages: [
        task.messages[0]!,
        {
          ...task.messages[1]!,
          text: "Read",
          reasoning: { text: "The notes are", status: "complete" },
        },
      ],
    } satisfies WorkspaceTask;
    expect(sentAsChange(task, to).held).toEqual(to);
  });

  it("removes, adds and reorders items, and clears a field that is gone", () => {
    const { contextBudget, ...rest } = task;
    void contextBudget;
    const to = {
      ...rest,
      messages: [task.messages[1]!, task.messages[0]!],
      actions: [
        {
          id: "a2",
          action: "Write a file",
          target: "summary.md",
          status: "completed",
          sequence: 3,
        },
      ],
      views: [
        {
          id: "v1",
          callId: "c1",
          kind: "diagram",
          title: "Steps",
          source: "flowchart LR\n  A --> B",
        },
      ],
      phase: { kind: "interrupted" },
    } satisfies WorkspaceTask;
    expect(sentAsChange(task, to).held).toEqual(to);
  });

  it("sends nothing when nothing the window holds changed", () => {
    const feed = new WindowFeed();
    feed.translate({ kind: "workspaceSnapshot", data: workspace([task]) });
    expect(
      feed.translate({
        kind: "taskChanged",
        data: {
          ...task,
          modelHistory: [],
          messages: task.messages.map((message) => ({ ...message })),
        },
      }),
    ).toBeUndefined();
  });
});
