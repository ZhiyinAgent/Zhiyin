/**
 * What a connection is, to the manager: something that lists tools and calls
 * them, and — for one the app ships — how it describes its own calls.
 */

import type {
  ActionDetail,
  ProducedFile,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";

export type McpConnectionTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
};

export interface McpConnection {
  listTools(): Promise<readonly McpConnectionTool[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
    binding?: string,
  ): Promise<unknown>;
  close(): Promise<void>;
  /**
   * Hears the server say its tools changed, with the tools it now offers. Only
   * a server that announces such changes ever calls the listener.
   */
  onToolsChanged?(
    listener: (tools: readonly McpConnectionTool[]) => void,
  ): void;
}

/**
 * A connection the application supplies rather than the person configuring:
 * it ships inside the app, has no endpoint to point elsewhere and no account
 * to sign in to, and so it is not editable, removable, or credentialed.
 */
export type BuiltInMcpServer = {
  readonly id: string;
  readonly name: string;
  /** One in-process connection is created for each conversation scope. */
  readonly scope?: "conversation";
  /** Opened on first use, and closed when the application shuts down. */
  open(scope?: string): Promise<McpConnection>;
  inspect?(
    name: string,
    args: Readonly<Record<string, unknown>>,
    scope?: string,
  ): Promise<ToolCallInspection>;
  describeResult?(
    name: string,
    args: Readonly<Record<string, unknown>>,
    result: ToolInvocationResult,
    scope?: string,
  ): readonly ActionDetail[];
  /**
   * The workspace files a successful call wrote, given the value the call
   * returned. Only a built-in may declare them: a declared file becomes one
   * the person is shown as the work's output (ADR 0008).
   */
  produced?(
    name: string,
    args: Readonly<Record<string, unknown>>,
    value: unknown,
    scope?: string,
  ): readonly ProducedFile[];
  forget?(scope: string): Promise<void>;
  /**
   * For a connection scoped to conversations, whose connections each belong to
   * one: what it offers and whether it can work on this machine, answered
   * without any conversation. Throws with a reason a person can read when it
   * cannot.
   */
  describe?(): Promise<readonly McpConnectionTool[]>;
};
