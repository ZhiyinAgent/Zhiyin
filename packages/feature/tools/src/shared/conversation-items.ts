/**
 * What the application keeps for each conversation that a tool can reach: a
 * command's whole output, a text or a picture the person attached, and when
 * each file was last read. Supplied by the application; this feature only
 * names what it needs. Every item is scoped to one conversation, so a model
 * can never read what another conversation kept.
 */

import type { FileRead, StoredPicture } from "@zhiyin/contract";

export interface ConversationItems {
  /** Where a kept item is, or why it is not there. */
  locate(
    conversationId: string,
    kind: "output" | "attachment",
    id: string,
  ): Promise<
    | { readonly status: "ready"; readonly path: string }
    | { readonly status: "missing"; readonly reason: string }
  >;
  /** Keeps a whole output as a file the conversation can read again. */
  keepOutput(
    conversationId: string,
    file: string,
  ): Promise<
    | { readonly status: "kept"; readonly id: string }
    | { readonly status: "refused"; readonly reason: string }
  >;
  lastRead(conversationId: string, path: string): Promise<FileRead | undefined>;
  noteRead(conversationId: string, path: string, read: FileRead): Promise<void>;
  /** A picture the person attached in this conversation, or why it is gone. */
  readPicture?(conversationId: string, id: string): Promise<StoredPicture>;
}

/** An address a model reads a kept item by: `output://<id>`, `attachment://<id>`. */
export function keptAddress(
  path: string,
): { readonly kind: "output" | "attachment"; readonly id: string } | undefined {
  const match = /^(output|attachment):\/\/(.+)$/.exec(path.trim());
  return match
    ? { kind: match[1] as "output" | "attachment", id: match[2] as string }
    : undefined;
}

/**
 * A path as the person reads it: a kept item is named by where it comes from,
 * never by its id, which says nothing to them; any other path as it is. Alone
 * it follows a title that says what it is; in a list it says that too.
 */
export function shownPath(path: string, inList = false): string {
  const kept = keptAddress(path);
  if (!kept) return path;
  if (kept.kind === "output")
    return inList
      ? "a saved output kept in this conversation"
      : "kept in this conversation";
  return inList
    ? "something attached to this conversation"
    : "attached to this conversation";
}
