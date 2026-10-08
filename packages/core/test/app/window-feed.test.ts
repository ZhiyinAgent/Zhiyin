/**
 * What the window is sent. A long conversation is the useful kind, so what
 * crosses to the window has to follow the change, not the size of the
 * conversation — and the window's copy, built only from what it was sent, has
 * to stay the core's.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyConversationLists,
  WindowCopy,
  type AppEvent,
  type TaskAction,
  type TaskMessage,
  type WorkspaceSnapshot,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { ModelEvent } from "@zhiyin/model-client";
import { calls, stubDependencies, loopFrom, type TestApp } from "./support.js";

/**
 * Room above the 39 KB this stream measures. Sent whole each time, the same
 * thousand fragments measured 254 copies of the conversation, 17.1 MB in all.
 */
const streamedBytesBound = 60_000;

const paragraph =
  "The report covers the regional figures for the quarter, the change against the last one, and what the change is likely to mean for the next. ".repeat(
    4,
  );

/** Thirty exchanges, each with two actions: sixty actions in all. */
function longConversation(): WorkspaceTask {
  const messages: TaskMessage[] = [];
  const actions: TaskAction[] = [];
  for (let turn = 0; turn < 30; turn += 1) {
    messages.push({
      id: `user-${turn}`,
      role: "user",
      text: `Step ${turn}: look at the next part of the report.`,
      sequence: turn * 4,
    });
    for (const half of [0, 1])
      actions.push({
        id: `action-${turn}-${half}`,
        action: "Read a file",
        target: `reports/part-${turn}-${half}.md`,
        toolName: "read_file",
        detail: paragraph,
        sequence: turn * 4 + 1 + half,
        status: "completed",
      });
    messages.push({
      id: `assistant-${turn}`,
      role: "assistant",
      text: paragraph,
      sequence: turn * 4 + 3,
    });
  }
  return {
    id: "task-1",
    title: "The quarterly report",
    titleSource: "manual",
    updatedAt: "2026-09-03T10:00:00.000Z",
    updatedLabel: "Last week",
    ...emptyConversationLists,
    messages,
    actions,
    phase: { kind: "interrupted" },
  };
}

function savedWorkspace(tasks: readonly WorkspaceTask[]) {
  return async () => ({
    runtime: {
      tasks: "available" as const,
      capabilities: "available" as const,
    },
    selectedTaskId: tasks[0]?.id ?? null,
    tasks: [...tasks],
    skills: [],
    subagents: [],
    mcpServers: [],
    usage: { status: "unavailable" as const, reason: "None." },
  });
}

/** What the window would hold, built from nothing but what it was sent. */
function windowOf(events: readonly AppEvent[]) {
  const copy = new WindowCopy();
  const resend: string[] = [];
  for (const event of events) {
    const outcome = copy.receive(event);
    resend.push(...(outcome?.resend ?? []));
  }
  return { snapshot: copy.snapshot(), resend };
}

/** The core's own state as the window is meant to see it. */
function asTheWindowSees(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      modelHistory: [],
      modelResponses: [],
    })),
  };
}

function bytesOf(events: readonly AppEvent[]): number {
  return events.reduce(
    (total, event) => total + JSON.stringify(event).length,
    0,
  );
}

function loopOver(
  events: AppEvent[],
  model?: () => AsyncGenerator<ModelEvent>,
) {
  const deps = stubDependencies((event) => events.push(event));
  return loopFrom({
    ...deps,
    // About what is sent, not how far the display trails the model.
    revealDelayMs: 0,
    sessions: {
      ...deps.sessions,
      loadWorkspace: savedWorkspace([longConversation()]),
    },
    model: model ? { ...deps.model, send: model } : deps.model,
  });
}

async function attached(loop: TestApp, events: AppEvent[]): Promise<void> {
  await loop.initialize();
  await loop.connectionsReady();
  events.length = 0;
  loop.attachWindow();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("what the window is sent", () => {
  it("sends only the new words while the assistant writes a thousand fragments into a sixty-action conversation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T10:00:00.000Z"));
    const events: AppEvent[] = [];
    // Ten milliseconds apart: ten seconds of writing, as a model writes.
    const loop = loopOver(events, async function* () {
      for (let fragment = 0; fragment < 1000; fragment += 1) {
        vi.setSystemTime(Date.now() + 10);
        yield { kind: "textDelta", text: "word " };
      }
      yield { kind: "done" };
    });
    await attached(loop, events);
    const attaching = events.length;
    expect(bytesOf(events)).toBeGreaterThan(60_000);

    await loop.start("task-1", "Sum it up.");

    expect(bytesOf(events.slice(attaching))).toBeLessThan(streamedBytesBound);
    const seen = windowOf(events);
    expect(seen.resend).toEqual([]);
    expect(seen.snapshot?.tasks).toEqual(
      asTheWindowSees(loop.snapshot()).tasks,
    );
  });

  it("leaves the window's copy, built only from what it was sent, the same as the core's", async () => {
    const events: AppEvent[] = [];
    const loop = loopOver(events, calls(["read_file", { path: "notes.md" }]));
    await attached(loop, events);

    await loop.start("task-1", "Read the notes.");
    await loop.renameTask("task-1", "Notes, read");
    const second = await loop.createTask();
    await loop.selectTask("task-1");
    await loop.deleteTask(second);
    await loop.setAppearance("dark");

    const seen = windowOf(events);
    expect(seen.resend).toEqual([]);
    expect(seen.snapshot).toEqual(asTheWindowSees(loop.snapshot()));
    expect(events.map((event) => event.kind)).toContain("taskUpdated");
  });

  it("sends nothing for a snapshot that changed nothing, and only what changed for one that did", async () => {
    const events: AppEvent[] = [];
    const loop = loopOver(events);
    await attached(loop, events);
    events.length = 0;

    loop.emit({ kind: "workspaceSnapshot", data: loop.snapshot() });
    expect(events).toEqual([]);

    await loop.setAppearance("dark");
    expect(events).toEqual([
      { kind: "workspaceChanged", data: { fields: { appearance: "dark" } } },
    ]);
  });

  it("sends a window that attaches again the whole workspace", async () => {
    const events: AppEvent[] = [];
    const loop = loopOver(events);
    await attached(loop, events);
    events.length = 0;

    loop.attachWindow();

    expect(events).toEqual([
      { kind: "workspaceSnapshot", data: asTheWindowSees(loop.snapshot()) },
    ]);
  });

  it("sends a conversation whole again when the window missed one of its changes, and numbers its changes again from there", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T10:00:00.000Z"));
    const events: AppEvent[] = [];
    let paused!: () => void;
    const pause = new Promise<void>((resolve) => {
      paused = resolve;
    });
    let resume!: () => void;
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const loop = loopOver(events, async function* () {
      for (let fragment = 0; fragment < 20; fragment += 1) {
        vi.setSystemTime(Date.now() + 50);
        yield { kind: "textDelta", text: `${fragment} ` };
        if (fragment === 9) {
          paused();
          await resumed;
        }
      }
      yield { kind: "done" };
    });
    await attached(loop, events);
    const turn = loop.start("task-1", "Count.");
    await pause;

    const missed = events.filter((event) => event.kind === "taskUpdated")[2];
    expect(missed).toBeDefined();
    const received = events.filter((event) => event !== missed);
    expect(windowOf(received).resend).toEqual(["task-1"]);

    events.length = 0;
    await loop.resendTask("task-1");
    resume();
    await turn;

    expect(events[0]).toMatchObject({ kind: "taskChanged" });
    expect(events.find((event) => event.kind === "taskUpdated")).toMatchObject({
      data: { sequence: 1 },
    });
    expect(windowOf([...received, ...events]).snapshot?.tasks).toEqual(
      asTheWindowSees(loop.snapshot()).tasks,
    );
  });
});
