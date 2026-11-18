/**
 * The tools a conversation is offered, joined from each tool's own
 * definition. A lookup table, not a place for tool-specific logic.
 */

import type {
  ShellAvailability,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
  UserInputResponse,
} from "@zhiyin/contract";
import type { ConversationFolders } from "./folders/conversation-folders.js";
import type { CommandShell } from "./commands/shell.js";
import type { ToolDefinition } from "./tool-definition.js";

/** Typed data, never a rendered string and never a magic sentinel value. */
export type ToolResult = ToolInvocationResult;

/**
 * Inspection is asynchronous because some actions cannot be described
 * accurately without looking at the workspace first — whether a write creates
 * a file or replaces one is the difference the person approving it most needs
 * to see.
 */
export interface ToolRegistry {
  /**
   * What the conversation may call: the file tools only once it has a folder,
   * except reading what it kept by its own addresses.
   */
  list(conversationId?: string): readonly ToolSpec[];
  inspect(
    name: string,
    args: unknown,
    conversationId?: string,
  ): Promise<ToolCallInspection>;
  execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
    /** The conversation the call belongs to, for what it kept. */
    conversationId?: string,
    /** The most of its answer the model is shown, for a tool that pages. */
    answerTokens?: number,
  ): Promise<ToolResult>;
  completeUserInput?(
    name: string,
    args: unknown,
    response: UserInputResponse,
  ): Promise<ToolResult>;
  /** Whether the shell tool can run here, and why not when it can't. */
  shellAvailability?(): ShellAvailability;
  /** Re-detects the shell without restarting, updating what `list()` offers. */
  recheckShell?(): ShellAvailability;
}

function needsWorkspace(definition: ToolDefinition, args: unknown): boolean {
  return typeof definition.requiresWorkspace === "function"
    ? definition.requiresWorkspace(args)
    : definition.requiresWorkspace;
}

export class ToolTable implements ToolRegistry {
  readonly #definitions: ReadonlyMap<string, ToolDefinition>;
  readonly #folders: Pick<ConversationFolders, "folderOf">;
  readonly #shell: CommandShell;

  constructor(
    definitions: readonly ToolDefinition[],
    folders: Pick<ConversationFolders, "folderOf">,
    shell: CommandShell,
  ) {
    this.#definitions = new Map(
      definitions.map((definition) => [definition.spec.name, definition]),
    );
    this.#folders = folders;
    this.#shell = shell;
  }

  list(conversationId?: string): readonly ToolSpec[] {
    const { available } = this.#folders.folderOf(conversationId);
    return [...this.#definitions.values()]
      .filter(
        (definition) => available || definition.requiresWorkspace !== true,
      )
      .filter((definition) => this.#shell.path || !definition.requiresShell)
      .map(({ spec }) => spec);
  }

  shellAvailability(): ShellAvailability {
    return this.#shell.availability();
  }

  recheckShell(
    environment: NodeJS.ProcessEnv = process.env,
  ): ShellAvailability {
    return this.#shell.recheck(environment);
  }

  async inspect(
    name: string,
    args: unknown,
    conversationId?: string,
  ): Promise<ToolCallInspection> {
    const definition = this.#definitions.get(name);
    const folder = this.#folders.folderOf(conversationId);
    if (definition && needsWorkspace(definition, args) && !folder.available)
      return { ok: false, reason: "Choose a folder before using files." };
    if (definition?.requiresShell && !this.#shell.path)
      return { ok: false, reason: `The tool “${name}” is not available.` };
    return definition
      ? definition.inspect(args, conversationId, folder)
      : { ok: false, reason: `The tool “${name}” is not available.` };
  }

  async execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
    conversationId?: string,
    answerTokens?: number,
  ): Promise<ToolResult> {
    const definition = this.#definitions.get(name);
    const folder = this.#folders.folderOf(conversationId);
    if (definition && needsWorkspace(definition, args) && !folder.available)
      return { ok: false, reason: "Choose a folder before using files." };
    if (definition?.requiresShell && !this.#shell.path)
      return { ok: false, reason: `The tool “${name}” is not available.` };
    return definition
      ? definition.execute(args, signal, conversationId, folder, answerTokens)
      : { ok: false, reason: `The tool “${name}” is not available.` };
  }

  async completeUserInput(
    name: string,
    args: unknown,
    response: UserInputResponse,
  ): Promise<ToolResult> {
    const definition = this.#definitions.get(name);
    return definition?.completeUserInput
      ? definition.completeUserInput(args, response)
      : {
          ok: false,
          reason: `The tool “${name}” is not waiting for user input.`,
        };
  }
}
