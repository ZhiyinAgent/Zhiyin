/**
 * Reads one UTF-8 text file.
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

import { open, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts, textDetail } from "./action-detail.js";
import { fileKind } from "./file-content.js";
import { keptAddress, type ConversationItems } from "./conversation-items.js";
import { pageLines, readPage } from "./text-pages.js";
import type { Page } from "./text-pages.js";
import { fileDigest } from "./file-read-state.js";
import {
  describeBytes,
  errorCode,
  isAbortError,
  normalizePath,
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
        description: `How many lines to read, at most. Defaults to ${pageLines}; a page also stops at about 8,000 tokens.`,
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
};

const argumentNames = ["path", "startLine", "lineCount"];

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
  if (startLine === false || lineCount === false) return undefined;
  return {
    path: keptAddress(path) ? path.trim() : normalizePath(path),
    ...(startLine === undefined ? {} : { startLine }),
    ...(lineCount === undefined ? {} : { lineCount }),
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
    notice,
    size,
    onPage,
    tokens,
  }: {
    readonly notice?: string;
    readonly size?: number;
    readonly onPage?: (page: Page) => Promise<void>;
    readonly tokens?: number | undefined;
  } = {},
): Promise<ToolInvocationResult> {
  const start = input.startLine ?? 1;
  const page = await readPage(
    path,
    start,
    input.lineCount ?? pageLines,
    signal,
    notice,
    tokens,
  );
  if (start > 1 && start > page.totalLines)
    return {
      ok: false,
      reason: `${target} has ${page.totalLines.toLocaleString("en-US")} lines, so there is no line ${start}.`,
    };
  await onPage?.(page);
  const whole = start === 1 && page.last >= page.totalLines;
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
    const [realRoot, realTarget] = await Promise.all([
      realpath(root),
      realpath(resolve(root, input.path)),
    ]);
    // A link can point out of the workspace after the request was presented as
    // staying in it. The approval that was given was for the contained read.
    if (
      inspected.scope === "workspace" &&
      scopeOf(realRoot, realTarget) !== "workspace"
    ) {
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
    // A document is read, and shown, by read_document (ADR 0018). Anything
    // else that is not text is refused with what it actually is.
    if (kind.kind === "binary") {
      return {
        ok: false,
        reason:
          kind.mediaType || kind.named === "a PDF document"
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
          const ranges =
            previous?.digest === digest &&
            previous.totalLines === page.totalLines
              ? [...(previous.ranges ?? [])]
              : [];
          if (!page.cutLines && page.last >= page.first)
            ranges.push({ first: page.first, last: page.last });
          await items.noteRead(conversationId, realTarget, {
            modifiedMs: after.mtimeMs,
            size: after.size,
            readAt: new Date().toISOString(),
            digest,
            ranges,
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
