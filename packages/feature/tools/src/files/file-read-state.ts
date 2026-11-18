/**
 * What a conversation knows of a file it may change: whether it read the file
 * since the file last changed, by digest, and whether that read was whole.
 *
 * An edit needs a read of the file as it is now: an exact find cannot be
 * written for text the model has not seen, and the approval's diff shows the
 * lines a pattern or a replace-all changes. Replacing a file needs a whole
 * read, since everything the file holds goes.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { FileRead, ToolCallInspection } from "@zhiyin/contract";
import type { ConversationItems } from "../shared/conversation-items.js";
import type { Page } from "./reading/text-pages.js";

export type ReadStateContext = {
  readonly items?: ConversationItems | undefined;
  readonly conversationId?: string | undefined;
  /** Zhiyin's own folders, which no write reaches, whatever is approved. */
  readonly protect?: readonly string[] | undefined;
};

/** A place in a file: every line before `line`, and `characters` of that one. */
type Place = { readonly line: number; readonly characters: number };

/** A digest of the bytes on disk, streamed so large files do not fill memory. */
export async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const before = (a: Place, b: Place) =>
  a.line < b.line || (a.line === b.line && a.characters < b.characters);

/**
 * What a read knows of the file once this page was shown. Pages count
 * towards a whole read when each starts where the ones before it reached, so
 * reading on from where a page says the file goes on reads it whole. A line
 * cut short, as one past its first MiB in a file that is not UTF-8, is never
 * read past.
 */
export function readWithPage(
  earlier: FileRead | undefined,
  page: Page,
): Pick<FileRead, "readThrough" | "whole" | "cutShort"> {
  const { part } = page;
  const cutShort =
    part?.held !== undefined || Boolean(earlier?.cutShort) || undefined;
  const reached = earlier?.readThrough ?? { line: 1, characters: 0 };
  const start = {
    line: page.first,
    characters: part?.line === page.first ? part.first - 1 : 0,
  };
  const end =
    part?.line === page.last &&
    (part.held !== undefined || part.last < (part.characters ?? 0))
      ? { line: part.line, characters: part.last }
      : { line: page.last + 1, characters: 0 };
  const through =
    !before(reached, start) && before(reached, end) ? end : reached;
  return through.line > page.totalLines
    ? { whole: true }
    : { readThrough: through, ...(cutShort ? { cutShort } : {}) };
}

/**
 * Records what the model knows of a file after its own edit succeeded. The
 * edit was only applied because the file still matched the model's last read,
 * so the file stays read, and read whole if it was.
 */
export async function noteOwnEdit(
  path: string,
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
    await items.noteRead(conversationId, path, {
      modifiedMs: file.mtimeMs,
      size: file.size,
      readAt: new Date().toISOString(),
      digest,
      ...(read.whole ? { whole: true } : {}),
    });
  } catch {
    // The edit succeeded. Left unrecorded, the next edit asks for a fresh read.
  }
}

/** Where a read in order goes on from, as read_file is asked for it. */
function goOnFrom(read: FileRead): string {
  const place = read.readThrough;
  if (!place || (place.line === 1 && place.characters === 0))
    return "from its first line";
  const line = place.line.toLocaleString("en-US");
  return place.characters
    ? `from line ${line}, character ${(place.characters + 1).toLocaleString("en-US")}`
    : `from line ${line}`;
}

/**
 * Refuses a change to a file the conversation has not read as it is now, or,
 * with `whole`, has not read whole. The refusal is correctable by a fresh
 * read, before a person sees an approval.
 */
export async function requireSeenFile(
  path: string,
  shownPath: string,
  context: ReadStateContext,
  { whole }: { readonly whole: boolean },
): Promise<Extract<ToolCallInspection, { readonly ok: false }> | undefined> {
  const { items, conversationId } = context;
  // A tool used without conversation storage asks for no read first.
  if (!items || !conversationId) return undefined;
  const read = await items.lastRead(conversationId, path);
  if (!read?.digest)
    return {
      ok: false,
      correctable: true,
      reason: whole
        ? `Read the complete current contents of ${shownPath} before changing it. No file was changed.`
        : `Read ${shownPath} before changing it. No file was changed.`,
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
  if (whole && !read.whole)
    return {
      ok: false,
      correctable: true,
      reason: read.cutShort
        ? `${shownPath} has a line longer than the file tools read: in a file that is not UTF-8, a line is read up to its first MiB, so no read shows the whole file. Replace it with a command or a script instead. No file was changed.`
        : `Read the complete current contents of ${shownPath} before replacing it: read on ${goOnFrom(read)}. No file was changed.`,
    };
  return undefined;
}
