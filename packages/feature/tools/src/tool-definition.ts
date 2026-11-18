/**
 * What each tool hands the registry: its schema, how it describes a call, how
 * it runs one, and what it needs to be offered. Each tool module builds its own
 * definition, so the registry joins them and knows nothing of any one tool.
 */

import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
  UserInputResponse,
} from "@zhiyin/contract";

/**
 * The folder a call works in: the conversation's, or the registry's own when
 * the conversation entered none.
 */
export type Folder = {
  /** Where paths resolve. With no folder, where Zhiyin runs, and unused. */
  readonly root: string;
  readonly available: boolean;
};

export type ToolDefinition = {
  readonly spec: ToolSpec;
  readonly inspect: (
    args: unknown,
    conversationId: string | undefined,
    folder: Folder,
  ) => Promise<ToolCallInspection>;
  readonly execute: (
    args: unknown,
    signal: AbortSignal | undefined,
    conversationId: string | undefined,
    folder: Folder,
    answerTokens: number | undefined,
  ) => Promise<ToolInvocationResult>;
  /**
   * Whether the call needs a chosen folder. A tool that also reads what a
   * conversation kept is offered without one, and answers by the call.
   */
  readonly requiresWorkspace: boolean | ((args: unknown) => boolean);
  /** Withdrawn, dynamically, when no shell is currently resolved. */
  readonly requiresShell?: boolean;
  readonly completeUserInput?: (
    args: unknown,
    response: UserInputResponse,
  ) => Promise<ToolInvocationResult>;
};
