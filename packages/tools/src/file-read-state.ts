import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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

/** A range kept only where it lies inside `first`..`last`, moved by `shift`. */
function clipped(
  ranges: readonly FileSpan[],
  first: number,
  last: number,
  shift: number,
): FileSpan[] {
  return ranges.flatMap((range) => {
    const from = Math.max(range.first, first);
    const to = Math.min(range.last, last);
    return from > to ? [] : [{ first: from + shift, last: to + shift }];
  });
}

/**
 * Records what the model knows of a file after its own edit succeeded. The
 * edit was only applied because the file still matched the model's last read,
 * so the model knows the new text exactly where it knew the old one, plus the
 * text it wrote. Lines above the change keep their numbers, lines below it move
 * with it, and the changed block counts as seen only when the model had seen
 * every line of it before: an edit between two replacements the model never
 * read does not become known by being edited around.
 */
export async function noteOwnEdit(
  path: string,
  before: string,
  after: string,
  written: string,
  context: ReadStateContext,
): Promise<void> {
  const { items, conversationId } = context;
  if (!items || !conversationId) return;
  try {
    const read = await items.lastRead(conversationId, path);
    if (!read?.digest) return;
    const file = await stat(path);
    const digest = await fileDigest(path);
    // Someone changed the file right after the write: the model never saw that.
    if (digest !== createHash("sha256").update(written, "utf8").digest("hex"))
      return;
    if (read.whole) {
      await items.noteRead(conversationId, path, {
        modifiedMs: file.mtimeMs,
        size: file.size,
        readAt: new Date().toISOString(),
        digest,
        whole: true,
      });
      return;
    }
    if (read.totalLines === undefined) return;
    const old = before.split("\n");
    const now = after.split("\n");
    let prefix = 0;
    while (
      prefix < old.length &&
      prefix < now.length &&
      old[prefix] === now[prefix]
    )
      prefix += 1;
    let suffix = 0;
    while (
      suffix < old.length - prefix &&
      suffix < now.length - prefix &&
      old[old.length - 1 - suffix] === now[now.length - 1 - suffix]
    )
      suffix += 1;
    const shift = now.length - old.length;
    // One-based lines of the changed block, before and after.
    const oldChanged = { first: prefix + 1, last: old.length - suffix };
    const newChanged = { first: prefix + 1, last: now.length - suffix };
    const ranges = read.ranges ?? [];
    const changedSeen =
      oldChanged.first > oldChanged.last || coversSpan(read, oldChanged);
    const next = [
      ...clipped(ranges, 1, prefix, 0),
      ...(changedSeen && newChanged.first <= newChanged.last
        ? [newChanged]
        : []),
      ...clipped(ranges, oldChanged.last + 1, Number.MAX_SAFE_INTEGER, shift),
    ];
    await items.noteRead(conversationId, path, {
      modifiedMs: file.mtimeMs,
      size: file.size,
      readAt: new Date().toISOString(),
      digest,
      ranges: next,
      totalLines: read.totalLines + shift,
    });
  } catch {
    // The edit succeeded. Left unrecorded, the next edit asks for a fresh read.
  }
}

/** The refusal is correctable by a fresh read, before a person sees an approval. */
export async function requireSeenFile(
  path: string,
  shownPath: string,
  context: ReadStateContext,
  spans?: readonly FileSpan[],
): Promise<Extract<ToolCallInspection, { readonly ok: false }> | undefined> {
  const { items, conversationId } = context;
  // A tool used without conversation storage asks for no read first.
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
