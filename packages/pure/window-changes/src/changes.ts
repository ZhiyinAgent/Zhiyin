/**
 * The workspace after a change the core sent the window. The core keeps its
 * record of what the window holds by these same rules, so the two cannot
 * drift apart.
 */

import type {
  AppEvent,
  ListChange,
  TaskChange,
  WorkspaceChange,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";

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
