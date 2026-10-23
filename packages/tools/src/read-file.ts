/**
 * Reads one text file: UTF-8, UTF-16 with its byte-order mark, or, for text
 * that is not UTF-8, Windows-1252, said as such.
 *
 * A file inside the selected folder is ordinary work and runs without
 * interrupting anyone. A file outside it is a different action: the folder is
 * the scope a person consented to, so reaching past it is named as such and
 * decided again. Both are described here, and the description is what the
 * permission engine decides on — it never re-reads the path itself.
 *
 * Containment is settled twice, because the two answers can differ. The
 * inspection answers lexically, before approval. Execution answers again after
 * resolving links, and refuses when a path that was presented as contained
 * turns out not to be: an approval given for a workspace read must never buy
 * a read of something else.
 */

import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  estimatedTokens,
  type ToolCallInspection,
  type ToolInvocationResult,
  type ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts, textDetail } from "./action-detail.js";
import { fileKind, pdfDocument, type TextEncoding } from "@zhiyin/file-kinds";
import { firstLineNotUtf8 } from "./file-content.js";
import { keptAddress, type ConversationItems } from "./conversation-items.js";
import {
  legacyEncodingName,
  NoRoomError,
  NotUtf8Error,
  pageLines,
  pageTokens,
  readPage,
} from "./text-pages.js";
import type { Page } from "./text-pages.js";
import { fileDigest } from "./file-read-state.js";
import {
  describeBytes,
  errorCode,
  isAbortError,
  normalizePath,
  realLocation,
  scopeOf,
  toForwardSlashes,
  type PathScope,
} from "./workspace-path.js";

/** Enough of the head to tell text from anything else. */
const sampleBytes = 4096;

export const readFileSpec: ToolSpec = {
  access: "read",
  name: "read_file",
  description:
    "Read one text file. A workspace-relative path reads a file in the current workspace; an absolute path may read a file elsewhere on this computer, which the person is asked about first. `output://<id>` reads a tool's saved output and `attachment://<id>` a text the person pasted, as named in this conversation. Lines come numbered, a page at a time: when more remains, the answer ends by saying which startLine to ask for next. PDFs and pictures are read with read_document.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Workspace-relative path of the file to read, an absolute path for a file outside the workspace, or an output:// or attachment:// id.",
      },
      startLine: {
        type: "integer",
        minimum: 1,
        description: "The first line to read. Defaults to 1.",
      },
      lineCount: {
        type: "integer",
        minimum: 1,
        description: `How many lines to read, at most. Defaults to ${pageLines}; a page also stops at the most of one answer you are shown.`,
      },
      startCharacter: {
        type: "integer",
        minimum: 1,
        description:
          "Where in startLine to start, counted from 1, to read a line longer than one page in parts; the answer names the next one. Defaults to 1.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

type ReadArguments = {
  readonly path: string;
  readonly startLine?: number;
  readonly lineCount?: number;
  readonly startCharacter?: number;
};

const argumentNames = ["path", "startLine", "lineCount", "startCharacter"];

function lineNumber(value: unknown): number | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : false;
}

function readArguments(args: unknown): ReadArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args))
    return undefined;
  const source = args as Record<string, unknown>;
  if (Object.keys(source).some((key) => !argumentNames.includes(key)))
    return undefined;
  const path = source["path"];
  if (typeof path !== "string" || !path.trim()) return undefined;
  const startLine = lineNumber(source["startLine"]);
  const lineCount = lineNumber(source["lineCount"]);
  const startCharacter = lineNumber(source["startCharacter"]);
  if (startLine === false || lineCount === false || startCharacter === false)
    return undefined;
  return {
    path: keptAddress(path) ? path.trim() : normalizePath(path),
    ...(startLine === undefined ? {} : { startLine }),
    ...(lineCount === undefined ? {} : { lineCount }),
    ...(startCharacter === undefined ? {} : { startCharacter }),
  };
}

export function inspectReadTextFile(
  root: string,
  args: unknown,
): ToolCallInspection {
  const input = readArguments(args);
  if (!input) {
    return {
      ok: false,
      reason: "Choose a file path to read.",
      correctable: true,
    };
  }
  const command = `read_file(${JSON.stringify(input)})`;
  const kept = keptAddress(input.path);
  // What this conversation kept is part of it already: reading it again
  // reaches nothing new, so it is as contained as a workspace read.
  if (kept)
    return {
      ok: true,
      action:
        kept.kind === "output"
          ? "Read a saved tool output"
          : "Read a pasted text",
      target: input.path,
      access: "read",
      scope: "workspace",
      command,
    };
  const absolute = resolve(root, input.path);
  const scope: PathScope = scopeOf(root, absolute);
  if (scope === "outside") {
    return {
      ok: true,
      action: "Read a file outside the workspace",
      target: toForwardSlashes(absolute),
      detail:
        "This file is outside the folder you selected. Its contents become part of this conversation.",
      access: "read",
      scope: "outside",
      command,
    };
  }
  return {
    ok: true,
    action: "Read a workspace file",
    target: input.path,
    access: "read",
    scope: "workspace",
    command,
  };
}

export type ReadContext = {
  /** Whether a folder is chosen to read files from. */
  readonly workspace: boolean;
  readonly conversationId?: string;
  readonly items?: ConversationItems;
  /** The most this read may return, when it shares one answer with others. */
  readonly tokens?: number;
};

/** Reads what the conversation kept, by the address it was named by. */
async function readKept(
  input: ReadArguments,
  kept: NonNullable<ReturnType<typeof keptAddress>>,
  context: ReadContext,
  signal?: AbortSignal,
): Promise<ToolInvocationResult> {
  if (!context.items || !context.conversationId)
    return {
      ok: false,
      reason:
        "Saved output and pasted text can only be read in their conversation.",
    };
  const located = await context.items.locate(
    context.conversationId,
    kept.kind,
    kept.id,
  );
  if (located.status === "missing")
    return { ok: false, reason: located.reason };
  return pagedResult(input.path, located.path, input, signal, {
    tokens: context.tokens,
  });
}

async function pagedResult(
  target: string,
  path: string,
  input: ReadArguments,
  signal: AbortSignal | undefined,
  {
    notice = "",
    size,
    onPage,
    tokens,
    encoding = "utf-8",
  }: {
    readonly notice?: string;
    readonly size?: number;
    readonly onPage?: (page: Page) => Promise<void>;
    readonly tokens?: number | undefined;
    readonly encoding?: TextEncoding;
  } = {},
): Promise<ToolInvocationResult> {
  const start = input.startLine ?? 1;
  // The answer around the page, as it is sent: the path, written out, and the
  // line counts at their longest.
  const most = Number.MAX_SAFE_INTEGER;
  const around = estimatedTokens(
    JSON.stringify({
      ok: true,
      value: {
        path: target,
        text: "",
        totalLines: most,
        lines: `${most}-${most}`,
      },
    }),
  );
  const read = (
    encoding: TextEncoding | "by-line",
    said: string,
  ): Promise<Page> =>
    readPage(path, {
      startLine: start,
      startCharacter: input.startCharacter ?? 1,
      lineCount: input.lineCount ?? pageLines,
      signal,
      encoding,
      notice: `${notice}${said}`,
      tokens: (tokens ?? pageTokens) - around,
    });
  const paged = read(
    encoding,
    encoding === "utf-8"
      ? ""
      : `${target} is UTF-16 text; multi_edit changes only UTF-8 files.\n`,
  ).catch(async (error: unknown) => {
    if (!(error instanceof NotUtf8Error)) throw error;
    // Text on Windows that is not UTF-8 is most often in Windows' own code
    // page: each line that is not UTF-8 is shown so, and said to be a guess,
    // and the lines that are UTF-8 stay as they are.
    const line = await firstLineNotUtf8(
      createReadStream(path, signal ? { signal } : {}),
    );
    return read(
      "by-line",
      `${target} is not all UTF-8: line ${(line ?? 1).toLocaleString("en-US")} is the first that is not. Lines that are not UTF-8 are shown ${legacyEncodingName()}, which may not be their encoding, and multi_edit changes only UTF-8 files.\n`,
    );
  });
  // A round nearly spent leaves no room for any of the file: nothing is
  // shown, so nothing counts as read.
  const page = await paged.catch((error: unknown) => {
    if (error instanceof NoRoomError) return undefined;
    throw error;
  });
  if (!page)
    return {
      ok: false,
      reason: `No room is left in this round's answers to show any of ${target}. Read it in the next round.`,
    };
  if (start > 1 && start > page.totalLines)
    return {
      ok: false,
      reason: `${target} has ${page.totalLines.toLocaleString("en-US")} lines, so there is no line ${start}.`,
    };
  const { part } = page;
  if (part && part.last < part.first)
    return {
      ok: false,
      reason:
        part.held === undefined
          ? `Line ${part.line.toLocaleString("en-US")} of ${target} has ${(part.characters ?? 0).toLocaleString("en-US")} characters, so there is no character ${part.first.toLocaleString("en-US")}.`
          : `Line ${part.line.toLocaleString("en-US")} of ${target} is read up to its first MiB, ${part.held.toLocaleString("en-US")} characters, since the file is not UTF-8; character ${part.first.toLocaleString("en-US")} is past it.`,
    };
  await onPage?.(page);
  const whole = start === 1 && !page.part && page.last >= page.totalLines;
  return {
    ok: true,
    value: {
      path: target,
      text: page.text,
      totalLines: page.totalLines,
      ...(whole ? {} : { lines: `${page.first}-${page.last}` }),
    },
    ...detailsOf(
      facts(
        ["File", target],
        ["Size", size === undefined ? undefined : describeBytes(size)],
        [
          "Lines",
          whole
            ? page.totalLines
            : `${page.first}–${page.last} of ${page.totalLines}`,
        ],
      ),
      textDetail("Contents", page.plain, !whole),
    ),
  };
}

/** Ranges joined where they meet or overlap, in order. */
function joined(
  ranges: readonly { readonly first: number; readonly last: number }[],
): { first: number; last: number }[] {
  const out: { first: number; last: number }[] = [];
  for (const range of [...ranges].sort((a, b) => a.first - b.first)) {
    const previous = out.at(-1);
    if (previous && range.first <= previous.last + 1)
      previous.last = Math.max(previous.last, range.last);
    else out.push({ ...range });
  }
  return out;
}

/**
 * Says so when the file changed since this conversation last read it, so an
 * earlier page is not trusted as current. The read still happens.
 */
async function changedNotice(
  target: string,
  file: { readonly mtimeMs: number; readonly size: number },
  context: ReadContext,
): Promise<string> {
  const { items, conversationId } = context;
  if (!items || !conversationId) return "";
  const previous = await items
    .lastRead(conversationId, target)
    .catch(() => undefined);
  return previous &&
    (previous.modifiedMs !== file.mtimeMs || previous.size !== file.size)
    ? `This file changed since your last read at ${previous.readAt}; earlier pages may be out of date.\n`
    : "";
}

export async function runReadTextFile(
  root: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: ReadContext,
): Promise<ToolInvocationResult> {
  const inspected = inspectReadTextFile(root, args);
  if (!inspected.ok) return inspected;
  const input = readArguments(args);
  if (!input) return { ok: false, reason: "The file path is invalid." };
  const kept = keptAddress(input.path);
  if (kept) return readKept(input, kept, context, signal);
  if (!context.workspace)
    return { ok: false, reason: "Choose a folder before using files." };

  try {
    const real = await realLocation(root, input.path);
    const realTarget = real.path;
    // A link can point out of the workspace after the request was presented as
    // staying in it. The approval that was given was for the contained read.
    if (inspected.scope === "workspace" && real.scope !== "workspace") {
      return {
        ok: false,
        reason: "The file leads outside the current workspace.",
      };
    }
    const file = await stat(realTarget);
    if (!file.isFile()) {
      return { ok: false, reason: "The selected path is not a file." };
    }
    // What the file is, decided by its bytes rather than by its name.
    const handle = await open(realTarget, "r");
    let sample: Buffer;
    try {
      const buffer = Buffer.alloc(Math.min(sampleBytes, file.size));
      await handle.read(buffer, 0, buffer.length, 0);
      sample = buffer;
    } finally {
      await handle.close();
    }
    const kind = fileKind(sample);
    // A document is read, and shown, by read_document (ADR 0023). Anything
    // else that is not text is refused with what it actually is.
    if (kind.kind === "binary") {
      return {
        ok: false,
        reason:
          kind.mediaType || kind.named === pdfDocument
            ? `${inspected.target} is ${kind.named}. Read it with read_document.`
            : `${inspected.target} is not a text file${kind.named ? ` — it is ${kind.named}` : ""}. Reading it as text would produce nothing meaningful.`,
      };
    }
    const beforeDigest =
      context.items && context.conversationId
        ? await fileDigest(realTarget).catch(() => undefined)
        : undefined;
    return pagedResult(inspected.target, realTarget, input, signal, {
      notice: await changedNotice(realTarget, file, context),
      ...(kind.encoding ? { encoding: kind.encoding } : {}),
      size: file.size,
      tokens: context.tokens,
      onPage: async (page) => {
        const { items, conversationId } = context;
        if (!items || !conversationId || !beforeDigest) return;
        try {
          const digest = await fileDigest(realTarget);
          const after = await stat(realTarget);
          if (
            digest !== beforeDigest ||
            after.mtimeMs !== file.mtimeMs ||
            after.size !== file.size
          )
            return;
          const previous = await items.lastRead(conversationId, realTarget);
          // Reading a few lines of a file already known whole, and unchanged,
          // forgets none of it.
          if (previous?.whole && previous.digest === digest) return;
          const same =
            previous?.digest === digest &&
            previous.totalLines === page.totalLines;
          const ranges = same ? [...(previous.ranges ?? [])] : [];
          let lineParts = same ? [...(previous.lineParts ?? [])] : [];
          const cutShort =
            page.part?.held !== undefined || (same && previous.cutShort);
          if (page.whole) ranges.push(page.whole);
          const { part } = page;
          if (part?.characters !== undefined) {
            const { line, characters } = part;
            const earlier = lineParts.find(
              (entry) => entry.line === line && entry.characters === characters,
            );
            const parts = joined([
              ...(earlier?.parts ?? []),
              { first: part.first, last: part.last },
            ]);
            lineParts = lineParts.filter((entry) => entry !== earlier);
            // Read in every part, a line counts as read whole.
            if (parts[0]?.first === 1 && parts[0].last >= characters)
              ranges.push({ first: line, last: line });
            else lineParts.push({ line, characters, parts });
          }
          await items.noteRead(conversationId, realTarget, {
            modifiedMs: after.mtimeMs,
            size: after.size,
            readAt: new Date().toISOString(),
            digest,
            ranges,
            ...(lineParts.length ? { lineParts } : {}),
            ...(cutShort ? { cutShort: true } : {}),
            totalLines: page.totalLines,
            ...(page.totalLines === 0 ? { whole: true } : {}),
          });
        } catch {
          // Reading still succeeds. An unrecorded read grants no write access.
        }
      },
    });
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return {
        ok: false,
        reason:
          inspected.scope === "outside"
            ? `${inspected.target} was not found.`
            : `${input.path} was not found in this workspace.`,
      };
    }
    if (isAbortError(error)) {
      return { ok: false, reason: "The file read was cancelled." };
    }
    return {
      ok: false,
      reason: "The file could not be read. Check that it exists and is text.",
    };
  }
}
