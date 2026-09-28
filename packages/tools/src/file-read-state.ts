import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { ConversationItems, FileRead } from "./conversation-items.js";

export type ReadStateContext = {
  readonly items?: ConversationItems | undefined;
  readonly conversationId?: string | undefined;
};

export type FileSpan = { readonly first: number; readonly last: number };

/** A digest of the bytes on disk, streamed so large files do not fill memory. */
export async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function coversSpan(read: FileRead, span: FileSpan): boolean {
  if (read.whole) return true;
  if (!read.ranges?.length) return false;
  let next = span.first;
  for (const range of [...read.ranges].sort((a, b) => a.first - b.first)) {
    if (range.last < next) continue;
    if (range.first > next) return false;
    next = Math.max(next, range.last + 1);
    if (next > span.last) return true;
  }
  return false;
}

/** The refusal is correctable by a fresh read, before a person sees an approval. */
export async function requireSeenFile(
  path: string,
  shownPath: string,
  context: ReadStateContext,
  spans?: readonly FileSpan[],
): Promise<Extract<ToolCallInspection, { readonly ok: false }> | undefined> {
  const { items, conversationId } = context;
  // Standalone tools without conversation storage retain their existing API.
  if (!items || !conversationId) return undefined;
  const read = await items.lastRead(conversationId, path);
  const needed =
    spans ??
    (read?.whole
      ? [{ first: 1, last: 1 }]
      : read?.totalLines === undefined
        ? undefined
        : [{ first: 1, last: read.totalLines }]);
  if (
    !read?.digest ||
    !needed ||
    !needed.every((span) => coversSpan(read, span))
  )
    return {
      ok: false,
      correctable: true,
      reason: spans
        ? `Read the part of ${shownPath} you intend to edit before changing it. No file was changed.`
        : `Read the complete current contents of ${shownPath} before changing it. No file was changed.`,
    };
  let current: string;
  try {
    current = await fileDigest(path);
  } catch {
    return {
      ok: false,
      correctable: true,
      reason: `${shownPath} could not be checked against what you read. Read it again before changing it.`,
    };
  }
  if (current !== read.digest)
    return {
      ok: false,
      correctable: true,
      reason: `${shownPath} changed since you read it. Read it again before changing it. No file was changed.`,
    };
  return undefined;
}
