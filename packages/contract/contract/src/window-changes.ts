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
