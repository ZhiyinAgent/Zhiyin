import type { FolderInstructions } from "./instructions.js";

/** One entry of a described workspace folder. */
export type WorkspaceEntry = {
  readonly path: string;
  readonly kind: "directory" | "file" | "link" | "other";
};

/** A folder as a turn is told about it: bounded, and honest about being cut. */
export type WorkspaceDescription = {
  readonly rootName: string;
  readonly entries: readonly WorkspaceEntry[];
  readonly truncated: boolean;
};

/**
 * The folder each conversation works in (ADR 0008). The tools feature
 * implements it; the agent loop and the core read it. Three layers must agree
 * on this shape exactly, which is what the contract is for (ADR 0002).
 *
 * Nothing here is offered to the model, so this is not a tool and reaching it
 * is not reaching past the group that joins what the model may call.
 */
export interface WorkspaceContext {
  /**
   * Puts a conversation in a folder, and answers the folder's name. It moves
   * only once the path resolves to an existing folder; on a failure it keeps
   * the folder it had.
   */
  enterFolder?(conversationId: string, path: string): Promise<string>;
  /** Answers the name of a folder that can be worked in, or fails. */
  checkFolder?(path: string): Promise<string>;
  /**
   * Leaves a conversation in no folder: once the conversation is gone, when
   * the folder it belongs in will not open, or when it goes back to having
   * none.
   */
  leaveFolder?(conversationId: string): void;
  describeWorkspace(conversationId: string): Promise<WorkspaceDescription>;
  /**
   * Where a conversation's folder really is, or nothing when it has none.
   * Present so a composition can point another feature at the same folder
   * without either feature reaching for the other.
   */
  workspaceRoot(conversationId: string): string | undefined;
  /** The folder's AGENTS.md, when it has one. ADR 0017. */
  folderInstructions?(
    conversationId: string,
  ): Promise<FolderInstructions | undefined>;
}
