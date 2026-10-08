/**
 * A file this task produced, as the person reviewing the work sees it.
 *
 * Identified by its workspace-relative path: within one task there is one
 * record per file, so writing the same file twice updates that record instead
 * of accumulating near-duplicates. `change` says what the task did the first
 * time it touched the file — created something new, or altered something that
 * was already there — which is the distinction a reviewer cares about long
 * after the action itself has scrolled away.
 */
export type TaskArtifact = {
  readonly path: string;
  readonly name: string;
  readonly change: "created" | "updated";
  readonly bytes: number;
  /** ISO timestamp of the last action that wrote it. */
  readonly updatedAt: string;
};

/** Addressed by path: the caller already holds the record it asked about. */
export type ArtifactPreview =
  | {
      readonly status: "ready";
      readonly path: string;
      readonly text: string;
      readonly truncated: boolean;
    }
  | {
      readonly status: "missing";
      readonly path: string;
      readonly reason: string;
    }
  | {
      readonly status: "unreadable";
      readonly path: string;
      readonly reason: string;
    };

export type ArtifactExport =
  | { readonly status: "saved"; readonly destination: string }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly reason: string };

/** A conversation saved as a page to read, or as a record to analyse. */
export type ConversationFormat = "html" | "json";
