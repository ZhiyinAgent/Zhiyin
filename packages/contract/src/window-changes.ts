import type { AppEvent } from "./core-api.js";
import type { TaskMessage } from "./messages.js";
import type { TaskAction } from "./task-action.js";
import type { WorkspaceTask } from "./task.js";
import type { TaskView } from "./views.js";
import type { WorkspaceSnapshot } from "./workspace-snapshot.js";

/**
 * What changed in one conversation since the window was last sent it. The
 * window applies each in order; a conversation sent whole starts its numbering
 * again, so the first change after it is 1, and a missing number means the
 * window must ask for the conversation whole again.
 */
export type TaskChange = {
  readonly taskId: string;
  readonly sequence: number;
  /** Fields that changed, each sent whole. */
  readonly fields?: Partial<WorkspaceTask>;
  /** Fields no longer present. */
  readonly cleared?: readonly (keyof WorkspaceTask)[];
  /** Words added to the end of a message's text or its reasoning. */
  readonly appended?: readonly AppendedText[];
  readonly messages?: ListChange<TaskMessage>;
  readonly actions?: ListChange<TaskAction>;
  readonly views?: ListChange<TaskView>;
};

export type AppendedText = {
  readonly messageId: string;
  readonly text?: string;
  readonly reasoning?: string;
};

export type ListChange<T> = {
  /** Items new or changed, each sent whole. */
  readonly upserted?: readonly T[];
  readonly removed?: readonly string[];
  /**
   * Every id in order, sent only when the order is not the old one with
   * removed items left out and new ones added after.
   */
  readonly order?: readonly string[];
};

/** What changed in the workspace beyond its conversations' own contents. */
export type WorkspaceChange = {
  readonly fields?: Partial<Omit<WorkspaceSnapshot, "tasks">>;
  readonly cleared?: readonly (keyof WorkspaceSnapshot)[];
  /** The open conversations' ids in order, when that changed. */
  readonly taskIds?: readonly string[];
  /** Conversations sent whole; each starts its numbering again. */
  readonly tasks?: readonly WorkspaceTask[];
  readonly taskChanges?: readonly TaskChange[];
};

export function applyTaskChange(
  task: WorkspaceTask,
  change: TaskChange,
): WorkspaceTask {
  const next: Record<string, unknown> = { ...task, ...change.fields };
  for (const key of change.cleared ?? []) delete next[key];
  let messages = change.messages
    ? applyList(task.messages, change.messages)
    : task.messages;
  if (change.appended?.length) {
    const appended = new Map(
      change.appended.map((item) => [item.messageId, item]),
    );
    messages = messages.map((message) => {
      const more = appended.get(message.id);
      if (!more) return message;
      return {
        ...message,
        text: message.text + (more.text ?? ""),
        ...(message.reasoning && more.reasoning
          ? {
              reasoning: {
                ...message.reasoning,
                text: message.reasoning.text + more.reasoning,
              },
            }
          : {}),
      };
    });
  }
  next.messages = messages;
  if (change.actions) next.actions = applyList(task.actions, change.actions);
  if (change.views) next.views = applyList(task.views, change.views);
  return next as WorkspaceTask;
}

export function applyWorkspaceChange(
  snapshot: WorkspaceSnapshot,
  change: WorkspaceChange,
): WorkspaceSnapshot {
  const next: Record<string, unknown> = { ...snapshot, ...change.fields };
  for (const key of change.cleared ?? []) delete next[key];
  const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
  for (const task of change.tasks ?? []) byId.set(task.id, task);
  for (const taskChange of change.taskChanges ?? []) {
    const task = byId.get(taskChange.taskId);
    if (task) byId.set(task.id, applyTaskChange(task, taskChange));
  }
  const order = change.taskIds ?? snapshot.tasks.map((task) => task.id);
  next.tasks = order.flatMap((id) => byId.get(id) ?? []);
  return next as WorkspaceSnapshot;
}

function applyList<T extends { readonly id: string }>(
  items: readonly T[],
  change: ListChange<T>,
): readonly T[] {
  const removed = new Set(change.removed);
  const upserted = new Map(
    (change.upserted ?? []).map((item) => [item.id, item]),
  );
  const kept = items
    .filter((item) => !removed.has(item.id))
    .map((item) => upserted.get(item.id) ?? item);
  const known = new Set(kept.map((item) => item.id));
  const added = (change.upserted ?? []).filter((item) => !known.has(item.id));
  const merged = [...kept, ...added];
  if (!change.order) return merged;
  const byId = new Map(merged.map((item) => [item.id, item]));
  return change.order.flatMap((id) => byId.get(id) ?? []);
}

/**
 * The workspace after an event that changes part of it directly. The core
 * keeps its record of what the window holds by the same rule the window uses,
 * so the two cannot drift apart.
 */
export function followEvent(
  snapshot: WorkspaceSnapshot,
  event: AppEvent,
): WorkspaceSnapshot {
  switch (event.kind) {
    case "taskSelectionChanged":
      return { ...snapshot, selectedTaskId: event.data.taskId };
    case "taskRemoved":
      return {
        ...snapshot,
        selectedTaskId: event.data.selectedTaskId,
        tasks: snapshot.tasks.filter((task) => task.id !== event.data.taskId),
      };
    case "mcpServersChanged":
      return { ...snapshot, mcpServers: event.data };
    case "pluginsChanged":
      return { ...snapshot, plugins: event.data };
    case "usageChanged":
      return { ...snapshot, usage: event.data };
    default:
      return snapshot;
  }
}

/** A conversation sent whole: the one it replaces, or a new one first. */
export function withTask(
  snapshot: WorkspaceSnapshot,
  task: WorkspaceTask,
): WorkspaceSnapshot {
  const known = snapshot.tasks.some((item) => item.id === task.id);
  return {
    ...snapshot,
    tasks: known
      ? snapshot.tasks.map((item) => (item.id === task.id ? task : item))
      : [task, ...snapshot.tasks],
  };
}

export type WindowCopyUpdate = {
  /** The workspace as it now stands, when the event was about more than one conversation. */
  readonly snapshot?: WorkspaceSnapshot;
  /** The conversation as it now stands, when the event was about one. */
  readonly task?: WorkspaceTask;
  /** Conversations to ask for whole again: a change to them was missed. */
  readonly resend: readonly string[];
};

/**
 * The window's copy of the workspace, built from nothing but what it is sent.
 * A change is applied only on top of the one before it; past a missing one,
 * the conversation is asked for whole once, and its changes are set aside
 * until it arrives.
 */
export class WindowCopy {
  #snapshot: WorkspaceSnapshot | undefined;
  #sequences = new Map<string, number>();
  #asked = new Set<string>();

  snapshot(): WorkspaceSnapshot | undefined {
    return this.#snapshot;
  }

  receive(event: AppEvent): WindowCopyUpdate | undefined {
    const snapshot = this.#snapshot;
    if (event.kind === "workspaceSnapshot") {
      this.#snapshot = event.data;
      this.#sequences = new Map(event.data.tasks.map((task) => [task.id, 0]));
      this.#asked.clear();
      return { snapshot: event.data, resend: [] };
    }
    if (!snapshot)
      return event.kind === "taskChanged"
        ? { task: event.data, resend: [] }
        : undefined;
    if (event.kind === "taskChanged") {
      this.#received(event.data.id);
      this.#snapshot = withTask(snapshot, event.data);
      return { task: event.data, resend: [] };
    }
    if (event.kind === "taskUpdated") {
      const task = snapshot.tasks.find((item) => item.id === event.data.taskId);
      if (!task || !this.#follows(event.data))
        return { resend: this.#ask(event.data.taskId) };
      const next = applyTaskChange(task, event.data);
      this.#snapshot = withTask(snapshot, next);
      return { task: next, resend: [] };
    }
    if (event.kind === "workspaceChanged") {
      for (const task of event.data.tasks ?? []) this.#received(task.id);
      const resend: string[] = [];
      const taskChanges = (event.data.taskChanges ?? []).filter((change) => {
        if (this.#follows(change)) return true;
        resend.push(...this.#ask(change.taskId));
        return false;
      });
      const next = applyWorkspaceChange(snapshot, {
        ...event.data,
        taskChanges,
      });
      const open = new Set(next.tasks.map((task) => task.id));
      for (const id of this.#sequences.keys())
        if (!open.has(id)) this.#sequences.delete(id);
      this.#snapshot = next;
      return { snapshot: next, resend };
    }
    if (event.kind === "taskRemoved") {
      this.#sequences.delete(event.data.taskId);
      this.#asked.delete(event.data.taskId);
    }
    this.#snapshot = followEvent(snapshot, event);
    return undefined;
  }

  #received(taskId: string): void {
    this.#sequences.set(taskId, 0);
    this.#asked.delete(taskId);
  }

  #follows(change: TaskChange): boolean {
    const last = this.#sequences.get(change.taskId);
    if (
      last === undefined ||
      this.#asked.has(change.taskId) ||
      change.sequence !== last + 1
    )
      return false;
    this.#sequences.set(change.taskId, change.sequence);
    return true;
  }

  #ask(taskId: string): string[] {
    if (this.#asked.has(taskId)) return [];
    this.#asked.add(taskId);
    return [taskId];
  }
}
