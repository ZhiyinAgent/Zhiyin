/**
 * What the application keeps for each conversation that a tool can reach: a
 * command's whole output, a text the person pasted, and when each file was
 * last read. Supplied by the application; this feature only names what it
 * needs. Every item is scoped to one conversation, so a model can never read
 * what another conversation kept.
 */

/** When a file was last read for a conversation, as it was then. */
export type FileRead = {
  readonly modifiedMs: number;
  readonly size: number;
  readonly readAt: string;
};

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
