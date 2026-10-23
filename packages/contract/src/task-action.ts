import type {
  ActionDetail,
  CommandFileChanges,
  FileChange,
  ToolInvocation,
} from "./index.js";

export type ConversationPermission = {
  readonly id: string;
  readonly label: string;
  readonly at: string;
  readonly kind: "file-folder" | "connector-tool";
  /** A tool, or every tool of a connection, written `mcp__<server>__*`. */
  readonly toolName: string;
  /** Canonical workspace root and folder for app-owned file changes. */
  readonly workspaceRoot?: string;
  readonly folder?: string;
  /**
   * Server and schema identity for one connector tool version; for every
   * tool of a connection, the allowance key its calls share.
   */
  readonly identity?: string;
};

export type ActionApproval = {
  readonly by:
    "you" | "conversation-permission" | "no-approval-needed" | "blocked";
  readonly at: string;
  readonly permissionId?: string;
  readonly label?: string;
  readonly reason?: string;
};

export type ActionRecovery = {
  readonly files: readonly {
    readonly path: string;
    readonly status: "protected" | "unprotected";
    readonly reason?: string;
  }[];
};

export type TaskAction = {
  readonly id: string;
  readonly action: string;
  readonly description?: string;
  readonly target: string;
  readonly command?: string;
  readonly toolName?: string;
  readonly evidence?: string;
  readonly approval?: ActionApproval;
  readonly specialistRunId?: string;
  readonly changes?: readonly FileChange[];
  readonly details?: readonly ActionDetail[];
  readonly detail?: string;
  /** Model-written and unverified. */
  readonly claim?: string;
  readonly invocation?: ToolInvocation;
  /**
   * Set only when code the app wrote declared that this call reads and changes
   * nothing. Absent means it may have changed something.
   */
  readonly readOnly?: true;
  /** Which of the files it changes were copied first, so they can be put back. */
  readonly recovery?: ActionRecovery;
  /** What changed in the folder while a shell command ran; never put back. */
  readonly commandChanges?: CommandFileChanges;
  /** When it began running, after any approval. */
  readonly startedAt?: string;
  /** The conversation's folder when it began running. */
  readonly folder?: string;
  readonly finishedAt?: string;
  readonly sequence: number;
  readonly status:
    | "running"
    | "completed"
    | "reported"
    | "failed"
    | "denied"
    | "blocked"
    | "cancelled";
  readonly reason?: string;
};

/**
 * Whether an action ran to its end, so what it would change was changed.
 * Everything that weighs an action's effects asks this one question.
 */
export function ranToItsEnd(action: Pick<TaskAction, "status">): boolean {
  return action.status === "completed" || action.status === "reported";
}
