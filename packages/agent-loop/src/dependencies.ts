import type {
  AppEvent,
  PictureFitting,
  WorkspaceContext,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { PermissionEngine } from "@zhiyin/permission-engine";
import type { Capabilities } from "@zhiyin/capabilities";
import type { Artifacts } from "@zhiyin/artifacts";
import type { AuditLog } from "@zhiyin/audit";
import type { Sessions } from "@zhiyin/session";
import type { ModelClient } from "@zhiyin/model-client";
import type { UsageTelemetry } from "@zhiyin/usage";
import type { ViewValidator } from "@zhiyin/views";
import type { Rewind } from "@zhiyin/rewind";
import type { ContextBudget } from "./conversation-context.js";
import type { WorkLimits } from "./work-limits.js";

export interface AgentLoopDependencies {
  readonly permissions: PermissionEngine;
  readonly capabilities: Capabilities;
  readonly workspace: WorkspaceContext;
  readonly artifacts: Artifacts;
  readonly views: ViewValidator;
  readonly rewind: Rewind;
  readonly audit: AuditLog;
  readonly sessions: Sessions;
  readonly model: ModelClient;
  /**
   * Writes the plan, the conversation's name, and the copy shown around an
   * action. Wrong here costs a worse label.
   */
  readonly guidanceModel: Pick<ModelClient, "send">;
  /**
   * Decides whether evidence satisfies a criterion, and distils the summary
   * every later turn is handed. Wrong here is wrong in ways nothing downstream
   * can detect, so it is named apart from `guidanceModel` rather than sharing
   * whatever that happens to point at.
   */
  readonly judgementModel: Pick<ModelClient, "send">;
  readonly contextBudget?: ContextBudget;
  readonly workLimits?: WorkLimits;
  readonly pictures?: PictureFitting;
  readonly newMessageId: () => string;
  readonly newActionId: () => string;
  readonly newSpecialistRunId: () => string;
  readonly newApprovalId: () => string;
  readonly newUserInputId: () => string;
  readonly now: () => Date;
  readonly host: TurnHost;
}

export interface TurnHost {
  find(taskId: string): WorkspaceTask | undefined;
  store(
    task: WorkspaceTask,
    options: {
      readonly persist: boolean;
      readonly commit: () => boolean;
      readonly announce: () => boolean;
    },
  ): Promise<void>;
  historyAvailable(): boolean;
  capabilitiesAvailable(): boolean;
  acceptsImages(): boolean;
  enterFolderOf(taskId: string): Promise<void>;
  watchBrowser(taskId: string): void;
  refreshConnections(): Promise<void>;
  recordUsage(
    usage: Parameters<UsageTelemetry["record"]>[0] extends infer Usage
      ? Omit<Usage, "recordedAt">
      : never,
  ): Promise<void>;
  reportIssue(notice: string): void;
  emit(event: AppEvent): void;
}
