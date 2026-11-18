import type {
  AppEvent,
  TaskChange,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";
import {
  applyTaskChange,
  applyWorkspaceChange,
  followEvent,
  withTask,
} from "./changes.js";

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
