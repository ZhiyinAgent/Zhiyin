import type { ActionDetail, FileChange, ToolInvocation } from "./index.js";

export type ConversationPermission = {
  readonly id: string;
  readonly label: string;
  readonly at: string;
  readonly kind: "file-folder" | "connector-tool";
  readonly toolName: string;
  /** Canonical workspace root and folder for app-owned file changes. */
  readonly workspaceRoot?: string;
  readonly folder?: string;
  /** Server and schema identity for one connector tool version. */
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

export type TaskAction = {
  readonly id: string;
  readonly action: string;
  readonly description?: string;
  readonly target: string;
  readonly command?: string;
  readonly toolName?: string;
  readonly evidence?: string;
  /** Legacy note on actions saved before structured approval provenance. */
  readonly policy?: string;
  readonly approval?: ActionApproval;
  readonly specialistRunId?: string;
  readonly changes?: readonly FileChange[];
  readonly details?: readonly ActionDetail[];
  readonly detail?: string;
  /** Model-written and unverified. */
  readonly claim?: string;
  readonly invocation?: ToolInvocation;
  readonly sequence?: number;
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
