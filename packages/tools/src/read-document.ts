/**
 * Reads one document: a PDF, or a picture (ADR 0018).
 *
 * Text is read by read_file; everything a person would call a document rather
 * than a file of text is read here, because reading one also shows it to the
 * person beside the conversation. Showing is not done here: the inspection
 * names the workspace document and the first page read, and the app around
 * the turn decides what the person sees. A file outside the workspace, or a
 * picture the person attached, is read but never named for showing.
 *
 * Bounded and decided like any other read: inside the folder runs without
 * asking; outside it is named as leaving it, and decided again. Containment
 * is settled twice, as read_file settles it.
 */

import { open, readFile, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { namesADocument } from "@zhiyin/contract";
import { detailsOf, facts, textDetail } from "./action-detail.js";
import { keptAddress, type ConversationItems } from "./conversation-items.js";
import { fileKind } from "./file-content.js";
import { imageSize } from "./image-size.js";
import {
  describePages,
  merged,
  missingPages,
  parsePages,
  readPdfText,
  renderPdfPages,
  type PdfPages,
  type PdfPagesSource,
} from "./read-pdf.js";
import {
  describeBytes,
  describeCommand,
  errorCode,
  isAbortError,
  normalizePath,
  scopeOf,
  toForwardSlashes,
} from "./workspace-path.js";

/**
 * A PDF is read whole to find its pages; each answer is still bounded by the
 * pages and characters it carries. Measured: an 83-page, 6.4 MB report opens
 * in 59 ms and gives eight pages of text in 125 ms, for 45 MB.
 */
const maximumPdfMegabytes = 50;
const maximumPdfBytes = maximumPdfMegabytes * 1024 * 1024;
/**
 * Z.AI documents 5 MB per image for `image_url` content.
 * Bounded below that: base64 adds a third again on the way out, and the file
 * has to survive being carried alongside everything else in the request.
 */
const maximumImageBytes = 3 * 1024 * 1024;
/**
 * Enough of the head to name the kind and read a picture's size out of it. A
 * JPEG keeps its dimensions after whatever metadata it carries, and an EXIF
 * block with a thumbnail in it runs to tens of kilobytes.
 */
const sampleBytes = 128 * 1024;

/** Office files, named by what a person calls them: Zhiyin does not read them. */
const office: Readonly<Record<string, string>> = {
  ".doc": "a Word document",
  ".docx": "a Word document",
  ".xls": "an Excel workbook",
  ".xlsx": "an Excel workbook",
  ".ppt": "a PowerPoint presentation",
  ".pptx": "a PowerPoint presentation",
};

export const readDocumentSpec: ToolSpec = {
  access: "read",
  name: "read_document",
  description:
    "Read one document — a PDF, or a picture (PNG, JPEG, WebP, GIF or BMP) — and show it to the person beside the conversation, at the first page you read. Use read_file for text files. A workspace-relative path reads a document in the current workspace; an absolute path may read one elsewhere on this computer, which the person is asked about first, and is not shown. `attachment://<id>` looks again at a picture the person attached. A long PDF is read a stretch of pages at a time. To point the person at the page your answer rests on, read that page. If the person chose what the space beside the conversation shows during this turn, it stays as they chose and the result says so.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Workspace-relative path of the document, an absolute path for one outside the workspace, or an attachment:// id.",
      },
      pages: {
        type: "string",
        description:
          'PDF only: which pages to read, as "4", "2-9" or a list like "2-5,8". Defaults to as many as fit from the first page. The first page read is the one shown.',
      },
      as: {
        type: "string",
        enum: ["text", "image"],
        description:
          'PDF only: "text" reads the words, and is the default. "image" draws the pages for you to look at, for a scanned document or one whose layout matters. Two pages at a time.',
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

type ReadArguments = {
  readonly path: string;
  readonly pages?: string;
  readonly as?: "text" | "image";
};

const argumentNames = ["path", "pages", "as"];

function readArguments(args: unknown): ReadArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args))
    return undefined;
  const source = args as Record<string, unknown>;
  if (Object.keys(source).some((key) => !argumentNames.includes(key)))
    return undefined;
  const path = source["path"];
  if (typeof path !== "string" || !path.trim()) return undefined;
  const pages = source["pages"];
  if (pages !== undefined && typeof pages !== "string") return undefined;
  const shape = source["as"];
  if (shape !== undefined && shape !== "text" && shape !== "image")
    return undefined;
  return {
    path: keptAddress(path) ? path.trim() : normalizePath(path),
    ...(pages === undefined ? {} : { pages }),
    ...(shape === undefined ? {} : { as: shape }),
  };
}

/** The first page a read asks for; a picture, or a list it cannot parse, has none. */
function firstPage(input: ReadArguments): number | undefined {
  const range = parsePages(input.pages);
  if (range === "invalid") return undefined;
  return range?.[0]?.first ?? 1;
}

export function inspectReadDocument(
  root: string,
  args: unknown,
): ToolCallInspection {
  const input = readArguments(args);
  if (!input)
    return {
      ok: false,
      reason: "Choose a document to read.",
      correctable: true,
    };
  const command = describeCommand(readDocumentSpec.name, input);
  // What the person attached is part of the conversation already: looking
  // again reaches nothing new, and shows nothing beside it.
  if (keptAddress(input.path)?.kind === "attachment")
    return {
      ok: true,
      action: "Look again at a picture you attached",
      target: input.path,
      access: "read",
      scope: "workspace",
      command,
    };
  const absolute = resolve(root, input.path);
  if (scopeOf(root, absolute) === "outside")
    return {
      ok: true,
      action: "Read a document outside the workspace",
      target: toForwardSlashes(absolute),
      detail:
        "This document is outside the folder you selected. What it holds becomes part of this conversation.",
      access: "read",
      scope: "outside",
      command,
    };
  // As the panel names it: relative to the folder, however the call spelled it.
  const path = toForwardSlashes(relative(root, absolute));
  const page = /\.pdf$/i.test(path) ? firstPage(input) : undefined;
  return {
    ok: true,
    action: "Read a workspace document",
    target: path,
    access: "read",
    scope: "workspace",
    command,
    ...(namesADocument(path)
      ? { document: page === undefined ? { path } : { path, page } }
      : {}),
  };
}

export type DocumentReadContext = {
  /** Whether the model this is read for can be shown a picture. */
  readonly acceptsImages: boolean;
  /** Where a PDF is read; in this process when none is given. */
  readonly pdfPages?: PdfPagesSource;
  readonly conversationId?: string;
  readonly items?: ConversationItems;
};

/** A picture the person attached, by its address, in this conversation only. */
async function readAttached(
  id: string,
  context: DocumentReadContext,
): Promise<ToolInvocationResult> {
  if (!context.conversationId || !context.items?.readPicture)
    return { ok: false, reason: "This picture is not available here." };
  if (!context.acceptsImages)
    return {
      ok: false,
      reason: `This model cannot be shown pictures, so attachment://${id} cannot be looked at here.`,
    };
  const stored = await context.items.readPicture(context.conversationId, id);
  if (stored.status !== "ready") return { ok: false, reason: stored.reason };
  const bytes = Buffer.byteLength(stored.data, "base64");
  return {
    ok: true,
    value: { path: `attachment://${id}`, mediaType: stored.mediaType, bytes },
    images: [{ mediaType: stored.mediaType, data: stored.data }],
    ...detailsOf(
      facts(
        ["Picture", `attachment://${id}`],
        ["Kind", stored.mediaType],
        ["Size", describeBytes(bytes)],
      ),
    ),
  };
}

/**
 * Adds the pages just read to what this conversation has read of this version
 * of a PDF, and says what that comes to once there is more than this read. A
 * model reading a long document a stretch at a time otherwise has only its
 * memory of which stretches it read, and says "read in full" when it did not.
 */
async function pdfCoverage(
  target: string,
  file: { readonly mtimeMs: number; readonly size: number },
  read: PdfPages,
  total: number,
  context: DocumentReadContext,
): Promise<string | undefined> {
  const { items, conversationId } = context;
  if (!items || !conversationId) return undefined;
  try {
    const previous = await items.lastRead(conversationId, target);
    const before =
      previous &&
      previous.modifiedMs === file.mtimeMs &&
      previous.size === file.size &&
      previous.totalPages === total
        ? (previous.pages ?? [])
        : [];
    const all = merged([...before, ...read]);
    await items.noteRead(conversationId, target, {
      modifiedMs: file.mtimeMs,
      size: file.size,
      readAt: new Date().toISOString(),
      pages: all,
      totalPages: total,
    });
    return before.length
      ? `Pages ${describePages(all)} of ${total} read in this conversation.`
      : undefined;
  } catch {
    // The read still succeeds; only the running count is missing.
    return undefined;
  }
}

async function readPdf(
  target: string,
  realTarget: string,
  file: { readonly mtimeMs: number; readonly size: number },
  input: ReadArguments,
  signal: AbortSignal | undefined,
  context: DocumentReadContext,
): Promise<ToolInvocationResult> {
  if (file.size > maximumPdfBytes)
    return {
      ok: false,
      reason: `This PDF is ${Math.round(file.size / 1024 / 1024)} MB; PDFs up to ${maximumPdfMegabytes} MB can be read.`,
    };
  const range = parsePages(input.pages);
  if (range === "invalid")
    return {
      ok: false,
      reason:
        'Ask for pages as a number, a range, or a list of both, like "4", "2-9" or "2-5,8".',
    };
  const bytes = await readFile(realTarget, signal ? { signal } : {});
  if (input.as === "image") {
    if (!context.acceptsImages)
      return {
        ok: false,
        reason:
          "This model cannot be shown pictures, so a page cannot be drawn for it. Read the text instead.",
      };
    const drawn = await renderPdfPages(bytes, range, signal, context.pdfPages);
    if (!drawn.ok) return drawn;
    const shown = describePages(drawn.read);
    const past = missingPages(drawn.pages, drawn.missing);
    const soFar = await pdfCoverage(
      realTarget,
      file,
      drawn.read,
      drawn.pages,
      context,
    );
    return {
      ok: true,
      value: {
        path: target,
        pages: drawn.pages,
        pagesRead: shown,
        ...(soFar ? { readSoFar: soFar } : {}),
        ...(drawn.complete
          ? {}
          : {
              truncated: true,
              more: `Drawn ${shown} of ${drawn.pages} pages. Ask for the rest with pages: "${describePages(drawn.rest)}".`,
            }),
        ...(past ? { missing: past } : {}),
      },
      images: drawn.images,
      ...detailsOf(
        facts(
          ["File", target],
          ["Size", describeBytes(file.size)],
          ["Pages drawn", `${shown} of ${drawn.pages}`],
        ),
      ),
    };
  }
  const read = await readPdfText(
    bytes,
    range,
    signal,
    undefined,
    context.pdfPages,
  );
  if (!read.ok) return read;
  const pagesRead = describePages(read.read);
  const soFar = await pdfCoverage(
    realTarget,
    file,
    read.read,
    read.pages,
    context,
  );
  return {
    ok: true,
    value: {
      path: target,
      text: read.text,
      pages: read.pages,
      pagesRead,
      ...(soFar ? { readSoFar: soFar } : {}),
      ...(read.complete ? {} : { truncated: true }),
    },
    ...detailsOf(
      facts(
        ["File", target],
        ["Size", describeBytes(file.size)],
        ["Pages", `${pagesRead} of ${read.pages}`],
      ),
      textDetail("Contents", read.text, !read.complete),
    ),
  };
}

async function readPicture(
  target: string,
  realTarget: string,
  file: { readonly size: number },
  kind: { readonly named?: string; readonly mediaType: string },
  sample: Buffer,
  signal: AbortSignal | undefined,
  context: DocumentReadContext,
): Promise<ToolInvocationResult> {
  if (!context.acceptsImages)
    return {
      ok: false,
      reason: `This model cannot be shown pictures, so ${target} cannot be looked at here.`,
    };
  if (file.size > maximumImageBytes)
    return {
      ok: false,
      reason: `This image is ${describeBytes(file.size)}, which is too large to send. Images must be under ${describeBytes(maximumImageBytes)}.`,
    };
  // Pixels, not just bytes: a photograph from a phone is comfortably under
  // any size limit and well past the limit on how large a picture may be.
  // Measured here and reported, but not refused here — what a model accepts
  // is not a property of a file, and a picture too large for one is scaled
  // on its way there rather than withheld from the person who asked for it.
  const size = imageSize(sample);
  const bytes = await readFile(realTarget, signal ? { signal } : {});
  return {
    ok: true,
    // The picture is the answer, and it travels beside this rather than
    // inside it: encoded here it would be a megabyte the model pays for and
    // cannot see.
    value: { path: target, mediaType: kind.mediaType, bytes: file.size },
    images: [{ mediaType: kind.mediaType, data: bytes.toString("base64") }],
    ...detailsOf(
      facts(
        ["Image", target],
        ["Kind", kind.named ?? kind.mediaType],
        ...(size
          ? ([["Pixels", `${size.width} × ${size.height}`]] as const)
          : []),
        ["Size", describeBytes(file.size)],
      ),
    ),
  };
}

export async function runReadDocument(
  root: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: DocumentReadContext,
): Promise<ToolInvocationResult> {
  const inspected = inspectReadDocument(root, args);
  if (!inspected.ok) return inspected;
  const input = readArguments(args);
  if (!input) return { ok: false, reason: "The document path is invalid." };
  const kept = keptAddress(input.path);
  if (kept?.kind === "attachment") return readAttached(kept.id, context);
  if (kept)
    return {
      ok: false,
      reason: `${input.path} is text this conversation kept. Read it with read_file.`,
    };
  const target = inspected.target;
  const named = office[extname(input.path).toLowerCase()];
  if (named)
    return {
      ok: false,
      reason: `${target} is ${named}. Zhiyin reads PDFs and pictures, not Word, Excel or PowerPoint files.`,
    };

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
    )
      return {
        ok: false,
        reason: "The file leads outside the current workspace.",
      };
    const file = await stat(realTarget);
    if (!file.isFile())
      return { ok: false, reason: "The selected path is not a file." };
    const handle = await open(realTarget, "r");
    let sample: Buffer;
    try {
      const buffer = Buffer.alloc(Math.min(sampleBytes, file.size));
      await handle.read(buffer, 0, buffer.length, 0);
      sample = buffer;
    } finally {
      await handle.close();
    }
    // What the file is, decided by its bytes rather than by its name.
    const kind = fileKind(sample);
    if (kind.kind === "text")
      return {
        ok: false,
        reason: `${target} is a text file. Read it with read_file.`,
      };
    if (kind.named === "a PDF document")
      return readPdf(target, realTarget, file, input, signal, context);
    if (kind.mediaType)
      return readPicture(
        target,
        realTarget,
        file,
        {
          mediaType: kind.mediaType,
          ...(kind.named ? { named: kind.named } : {}),
        },
        sample,
        signal,
        context,
      );
    return {
      ok: false,
      reason: `${target} is not a PDF or a picture${kind.named ? ` — it is ${kind.named}` : ""}.`,
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return {
        ok: false,
        reason:
          inspected.scope === "outside"
            ? `${target} was not found.`
            : `${input.path} was not found in this workspace.`,
      };
    if (isAbortError(error))
      return { ok: false, reason: "The document read was cancelled." };
    return { ok: false, reason: "The document could not be read." };
  }
}
