import {
  followEvent,
  withTask,
  type AppEvent,
  type AppendedText,
  type ListChange,
  type TaskChange,
  type TaskMessage,
  type WorkspaceChange,
  type WorkspaceSnapshot,
  type WorkspaceTask,
} from "@zhiyin/contract";

/**
 * What the window is sent, given what it was sent before. The window starts
 * with the whole workspace; after that each conversation's announcement
 * becomes what changed in it, numbered, and a later snapshot becomes what
 * changed in the workspace. An announcement that changed nothing is not sent.
 *
 * What it records is what the window holds, kept by the window's own rules,
 * so the two stay the same as long as nothing sent is lost. A window that
 * lost one asks for that conversation whole.
 */
export class WindowFeed {
  #sent: WorkspaceSnapshot | undefined;
  /** The last change sent of each conversation; absent, the next goes whole. */
  #sequences = new Map<string, number>();

  /** A window that holds nothing: the next snapshot goes whole. */
  restart(): void {
    this.#sent = undefined;
    this.#sequences.clear();
  }

  /** The next announcement of this conversation goes whole. */
  resend(taskId: string): void {
    this.#sequences.delete(taskId);
  }

  translate(event: AppEvent): AppEvent | undefined {
    if (event.kind === "workspaceSnapshot")
      return this.#snapshot(asTheWindowSees(event.data));
    if (event.kind === "taskChanged")
      return this.#task(withoutAuditRecords(event.data));
    if (this.#sent) {
      if (event.kind === "taskRemoved")
        this.#sequences.delete(event.data.taskId);
      this.#sent = followEvent(this.#sent, event);
    }
    return event;
  }

  #snapshot(snapshot: WorkspaceSnapshot): AppEvent | undefined {
    const sent = this.#sent;
    this.#sent = snapshot;
    if (!sent) {
      this.#sequences = new Map(snapshot.tasks.map((task) => [task.id, 0]));
      return { kind: "workspaceSnapshot", data: snapshot };
    }
    const change = this.#workspaceChange(sent, snapshot);
    return change && { kind: "workspaceChanged", data: change };
  }

  #task(task: WorkspaceTask): AppEvent | undefined {
    const sent = this.#sent;
    // Before the window has the workspace, there is nothing to change.
    if (!sent) return { kind: "taskChanged", data: task };
    this.#sent = withTask(sent, task);
    const before = sent.tasks.find((item) => item.id === task.id);
    const last = this.#sequences.get(task.id);
    if (!before || last === undefined) {
      this.#sequences.set(task.id, 0);
      return { kind: "taskChanged", data: task };
    }
    const change = taskChange(before, task, last + 1);
    if (!change) return undefined;
    this.#sequences.set(task.id, change.sequence);
    return { kind: "taskUpdated", data: change };
  }

  #workspaceChange(
    before: WorkspaceSnapshot,
    after: WorkspaceSnapshot,
  ): WorkspaceChange | undefined {
    const { fields, cleared } = fieldChanges(before, after, ["tasks"]);
    const sentBefore = new Map(before.tasks.map((task) => [task.id, task]));
    const tasks: WorkspaceTask[] = [];
    const taskChanges: TaskChange[] = [];
    for (const task of after.tasks) {
      const previous = sentBefore.get(task.id);
      const last = this.#sequences.get(task.id);
      if (!previous || last === undefined) {
        tasks.push(task);
        this.#sequences.set(task.id, 0);
        continue;
      }
      const change = taskChange(previous, task, last + 1);
      if (!change) continue;
      taskChanges.push(change);
      this.#sequences.set(task.id, change.sequence);
    }
    const open = new Set(after.tasks.map((task) => task.id));
    for (const id of this.#sequences.keys())
      if (!open.has(id)) this.#sequences.delete(id);
    const taskIds = after.tasks.map((task) => task.id);
    const reordered = !sameIds(
      before.tasks.map((task) => task.id),
      taskIds,
    );
    const change: WorkspaceChange = {
      ...(fields ? { fields } : {}),
      ...(cleared ? { cleared } : {}),
      ...(reordered ? { taskIds } : {}),
      ...(tasks.length ? { tasks } : {}),
      ...(taskChanges.length ? { taskChanges } : {}),
    };
    return Object.keys(change).length ? change : undefined;
  }
}

function asTheWindowSees(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return { ...snapshot, tasks: snapshot.tasks.map(withoutAuditRecords) };
}

/**
 * What the model was sent, and the record of each request, are kept for the
 * next request, for replay and for audit. They are often the largest part of
 * a conversation, and nothing in the window reads them, so the window holds
 * both empty.
 */
function withoutAuditRecords(task: WorkspaceTask): WorkspaceTask {
  if (!task.modelHistory.length && !task.modelResponses.length) return task;
  return { ...task, modelHistory: [], modelResponses: [] };
}

const lists = ["messages", "actions", "views"] as const;

function taskChange(
  before: WorkspaceTask,
  after: WorkspaceTask,
  sequence: number,
): TaskChange | undefined {
  if (before === after) return undefined;
  const { fields, cleared } = fieldChanges(before, after, ["id", ...lists]);
  const appended: AppendedText[] = [];
  const messages = listChange(before.messages, after.messages, (old, item) => {
    const more = appendedText(old, item);
    if (more) appended.push(more);
    return Boolean(more);
  });
  const actions = listChange(before.actions, after.actions);
  const views = listChange(before.views, after.views);
  const change: Omit<TaskChange, "taskId" | "sequence"> = {
    ...(fields ? { fields } : {}),
    ...(cleared ? { cleared } : {}),
    ...(appended.length ? { appended } : {}),
    ...(messages ? { messages } : {}),
    ...(actions ? { actions } : {}),
    ...(views ? { views } : {}),
  };
  return Object.keys(change).length
    ? { taskId: after.id, sequence, ...change }
    : undefined;
}

function fieldChanges<T extends object>(
  before: T,
  after: T,
  skipped: readonly string[],
): { fields?: Partial<T>; cleared?: (keyof T)[] } {
  const was = before as Record<string, unknown>;
  const now = after as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  const cleared: string[] = [];
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (skipped.includes(key)) continue;
    if (!(key in now) || now[key] === undefined) {
      if (key in was && was[key] !== undefined) cleared.push(key);
    } else if (!same(was[key], now[key])) fields[key] = now[key];
  }
  return {
    ...(Object.keys(fields).length ? { fields: fields as Partial<T> } : {}),
    ...(cleared.length ? { cleared: cleared as (keyof T)[] } : {}),
  };
}

/**
 * Items new or changed, and removed, by id. `absorbed` takes a changed item
 * that can be sent some other way than whole.
 */
function listChange<T extends { readonly id: string }>(
  before: readonly T[],
  after: readonly T[],
  absorbed?: (old: T, item: T) => boolean,
): ListChange<T> | undefined {
  if (before === after) return undefined;
  const previous = new Map(before.map((item) => [item.id, item]));
  const upserted: T[] = [];
  for (const item of after) {
    const old = previous.get(item.id);
    if (old === item || (old && same(old, item))) continue;
    if (old && absorbed?.(old, item)) continue;
    upserted.push(item);
  }
  const present = new Set(after.map((item) => item.id));
  const removed = before
    .filter((item) => !present.has(item.id))
    .map((item) => item.id);
  const kept = before
    .filter((item) => present.has(item.id))
    .map((item) => item.id);
  const added = after
    .filter((item) => !previous.has(item.id))
    .map((item) => item.id);
  const order = after.map((item) => item.id);
  const reordered = !sameIds([...kept, ...added], order);
  if (!upserted.length && !removed.length && !reordered) return undefined;
  return {
    ...(upserted.length ? { upserted } : {}),
    ...(removed.length ? { removed } : {}),
    ...(reordered ? { order } : {}),
  };
}

/** Words added to the end of a message's text or reasoning, and nothing else. */
function appendedText(
  old: TaskMessage,
  item: TaskMessage,
): AppendedText | undefined {
  const { text: oldText, reasoning: oldReasoning, ...oldRest } = old;
  const { text, reasoning, ...rest } = item;
  if (!same(oldRest, rest) || !text.startsWith(oldText)) return undefined;
  if (Boolean(oldReasoning) !== Boolean(reasoning)) return undefined;
  if (
    oldReasoning &&
    reasoning &&
    (oldReasoning.status !== reasoning.status ||
      !reasoning.text.startsWith(oldReasoning.text))
  )
    return undefined;
  const textAdded = text.slice(oldText.length);
  const reasoningAdded =
    reasoning && oldReasoning
      ? reasoning.text.slice(oldReasoning.text.length)
      : "";
  return {
    messageId: item.id,
    ...(textAdded ? { text: textAdded } : {}),
    ...(reasoningAdded ? { reasoning: reasoningAdded } : {}),
  };
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
