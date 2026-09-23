import type { AppEvent, WorkspaceTask } from "@zhiyin/contract";

/**
 * An event as the window is sent it. What the model was sent of a conversation
 * is kept for the next request and for replay after a restart; it is often the
 * largest part of a conversation, and nothing in the window reads it.
 */
export function forTheWindow(event: AppEvent): AppEvent {
  if (event.kind === "taskChanged")
    return { ...event, data: withoutModelHistory(event.data) };
  if (event.kind === "workspaceSnapshot")
    return {
      ...event,
      data: {
        ...event.data,
        tasks: event.data.tasks.map(withoutModelHistory),
      },
    };
  return event;
}

function withoutModelHistory(task: WorkspaceTask): WorkspaceTask {
  if (!task.modelHistory) return task;
  const { modelHistory, ...rest } = task;
  void modelHistory;
  return rest;
}
