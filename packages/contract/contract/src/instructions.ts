/**
 * Standing instructions: what the person asks of every conversation, and what
 * a folder's AGENTS.md asks once they approve it. They guide style and
 * approach and never grant permission. ADR 0016.
 */

/** One source as the model was sent it. */
export type StandingInstruction = {
  /**
   * The person's own instructions, kept in memory as About you and How to
   * work, the project's How to work, or a folder's file.
   */
  readonly source: "about" | "how" | "project" | "folder";
  /** The file's path inside the folder, for a folder's instructions. */
  readonly path?: string;
  /** The text sent: the whole source, or its start when `truncated`. */
  readonly text: string;
  /** The size of the whole source. */
  readonly bytes: number;
  readonly truncated: boolean;
};

/** What the person said about one folder's instructions, as that file read. */
export type FolderInstructionsChoice = {
  readonly root: string;
  readonly hash: string;
  readonly use: boolean;
};

/** A folder's AGENTS.md as read, with the hash its approval is kept against. */
export type FolderInstructions = {
  readonly path: string;
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly hash: string;
};
