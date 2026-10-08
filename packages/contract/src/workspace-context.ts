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
 * The folder the work happens in. The tools feature implements it; the agent
 * loop and the core read it. Three layers must agree on this shape exactly,
 * which is what the contract is for (ADR 0002).
 *
 * Nothing here is offered to the model, so this is not a tool and reaching it
 * is not reaching past the group that joins what the model may call.
 */
export interface WorkspaceContext {
  selectWorkspace?(path: string): Promise<void>;
  describeWorkspace(): Promise<WorkspaceDescription>;
  /**
   * Where the workspace currently is, or nothing when no folder is selected.
   * Present so a composition can point another feature at the same folder
   * without either feature reaching for the other.
   */
  workspaceRoot(): string | undefined;
  /** The folder's AGENTS.md, when it has one. ADR 0012. */
  folderInstructions?(): Promise<FolderInstructions | undefined>;
}
