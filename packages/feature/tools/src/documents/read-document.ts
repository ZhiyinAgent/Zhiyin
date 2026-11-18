/**
 * Reads one document: a PDF, or a picture (ADR 0019).
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

import { open, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { namesADocument } from "@zhiyin/conversation-rules";
import { detailsOf, facts, textDetail } from "../shared/action-detail.js";
import {
  keptAddress,
  shownPath,
  type ConversationItems,
} from "../shared/conversation-items.js";
import { bringingDownloads, effectsOf } from "../shared/effects.js";
import { schemaInput, withSchemaProblems } from "@zhiyin/tool-input";
import { fileKind, pdfDocument } from "@zhiyin/file-kinds";
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
  realLocation,
  scopeOf,
  toForwardSlashes,
} from "../shared/workspace-path.js";
import type { ToolDefinition } from "../tool-definition.js";

/**
 * A PDF is read whole to find its pages; each answer is still bounded by the
 * pages and characters it carries. Measured: an 83-page, 6.4 MB report opens
 * in 59 ms and gives eight pages of text in 125 ms, for 45 MB.
 */
const maximumPdfMegabytes = 50;
const maximumPdfBytes = maximumPdfMegabytes * 1024 * 1024;
/**
 * The size of a picture the labs take, with the date each was checked, is in
 * the stack reference; Z.ai's is the smallest named there, 5 MB.
 * Bounded below that: base64 adds a third again on the way out, and the file
 * has to survive being carried alongside everything else in the request.
 */
const maximumImageMegabytes = 3;
const maximumImageBytes = maximumImageMegabytes * 1024 * 1024;
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

const readDocumentSpec: ToolSpec = {
  access: "read",
  name: "read_document",
  description: `Read one document — a PDF, or a picture (PNG, JPEG, WebP, GIF or BMP) — and show it to the person beside the conversation, at the first page you read. A video (.mp4) Zhiyin's 3D studio rendered is shown there too, for the person to play; you are not sent its frames. Use read_file for text files. A workspace-relative path reads a document in the current workspace; an absolute path may read one elsewhere on this computer, which the person is asked about first, and is not shown. \`attachment://<id>\` looks again at a picture the person attached. A long PDF is read a stretch of pages at a time. PDFs up to ${maximumPdfMegabytes} MB and pictures under ${maximumImageMegabytes} MB can be read. To point the person at the page your answer rests on, read that page. The space beside the conversation shows one thing at a time: the browser or a document. A document you write is shown there too. When you cite a page of a workspace document, write the citation as a Markdown link to the document's workspace path ending in #page=N, like [page 24](reports/q3.pdf#page=24), or to a picture's path with no page, and write a space in the path as %20; the person opens it beside the conversation by clicking it. If the person is looking at something they chose during this turn, it may stay as they chose; the result says what they see.`,
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

function readArguments(args: unknown): ReadArguments | undefined {
  const input = schemaInput<ReadArguments>(readDocumentSpec.inputSchema, args);
  if (!input?.path.trim()) return undefined;
  const { path, ...rest } = input;
  return {
    path: keptAddress(path) ? path.trim() : normalizePath(path),
    ...rest,
  };
}

/** The first page a read asks for; a picture, or a list it cannot parse, has none. */
function firstPage(input: ReadArguments): number | undefined {
  const range = parsePages(input.pages);
  if (range === "invalid") return undefined;
  return range?.[0]?.first ?? 1;
}

/**
 * The inspection as a person is shown it: a document Windows marks as
 * downloaded from the internet brings outside content.
 */
async function inspectReadDocument(
  root: string,
  args: unknown,
): Promise<ToolCallInspection> {
  const described = describeReadDocument(root, args);
  const input = readArguments(args);
  return input && !keptAddress(input.path)
    ? bringingDownloads(described, [resolve(root, input.path)])
    : described;
}

/** The inspection from the call's arguments alone. */
function describeReadDocument(root: string, args: unknown): ToolCallInspection {
  const input = readArguments(args);
  if (!input)
    return {
      ok: false,
      reason: withSchemaProblems(
        "Choose a document to read.",
        args,
        readDocumentSpec.inputSchema,
      ),
      correctable: true,
    };
  const command = describeCommand(readDocumentSpec.name, input);
  // What the person attached is part of the conversation already: looking
  // again reaches nothing new, and shows nothing beside it.
  if (keptAddress(input.path)?.kind === "attachment")
    return {
      ok: true,
      action: "Look again at a picture you attached",
      target: shownPath(input.path),
      command,
      effects: effectsOf({ reads: "app" }),
    };
  const absolute = resolve(root, input.path);
  if (scopeOf(root, absolute) === "outside")
    return {
      ok: true,
      action: "Read a document outside the workspace",
      target: toForwardSlashes(absolute),
      detail:
        "This document is outside the folder you selected. What it holds becomes part of this conversation.",
      command,
      effects: effectsOf({ reads: "elsewhere" }),
    };
  // As the panel names it: relative to the folder, however the call spelled it.
  const path = toForwardSlashes(relative(root, absolute));
  const page = /\.pdf$/i.test(path) ? firstPage(input) : undefined;
  return {
    ok: true,
    action: "Read a workspace document",
    target: path,
    command,
    effects: effectsOf({ reads: "workspace" }),
    ...(namesADocument(path)
      ? { document: page === undefined ? { path } : { path, page } }
      : {}),
  };
}

type DocumentReadContext = {
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

/**
 * A file as it was found: by the path asked for, where it really is, and its
 * size and date.
 */
type FoundFile = {
  readonly target: string;
  readonly realTarget: string;
  readonly file: { readonly mtimeMs: number; readonly size: number };
};

/** A PDF's pages drawn as pictures, for a model that can be shown them. */
async function drawnPdf(
  { target, realTarget, file }: FoundFile,
  bytes: Buffer,
  range: PdfPages | undefined,
  signal: AbortSignal | undefined,
  context: DocumentReadContext,
  said: { readonly note?: string } = {},
): Promise<ToolInvocationResult> {
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
      ...said,
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

async function readPdf(
  { target, realTarget, file }: FoundFile,
  input: ReadArguments,
  signal: AbortSignal | undefined,
  context: DocumentReadContext,
): Promise<ToolInvocationResult> {
  if (file.size > maximumPdfBytes)
    return {
      ok: false,
      reason: `This PDF is ${Math.round(file.size / 1024 / 1024)} MB; PDFs up to ${maximumPdfMegabytes} MB can be read. Split it into smaller PDFs with a command or a script, and read those.`,
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
    return await drawnPdf(
      { target, realTarget, file },
      bytes,
      range,
      signal,
      context,
    );
  }
  const read = await readPdfText(
    bytes,
    range,
    signal,
    undefined,
    context.pdfPages,
  );
  // Pages with no text, as a scan's or a drawing's, are only read by looking.
  if (!read.ok && read.noText)
    return context.acceptsImages
      ? await drawnPdf(
          { target, realTarget, file },
          bytes,
          range,
          signal,
          context,
          {
            note: "This PDF has no text: its pages are pictures or drawn lines, as a scan or a drawing is, so they are drawn here.",
          },
        )
      : {
          ok: false,
          reason:
            "This PDF has no text to read: its pages are pictures or drawn lines, as a scan or a drawing is, and this model cannot be shown pictures.",
        };
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
  { target, realTarget, file }: FoundFile,
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
      reason: `This image is ${describeBytes(file.size)}, which is too large to send. Images must be under ${maximumImageMegabytes} MB. Make a smaller copy with a command or a script, such as a JPEG or a scaled-down picture, and read that.`,
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

async function runReadDocument(
  root: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: DocumentReadContext,
): Promise<ToolInvocationResult> {
  const inspected = describeReadDocument(root, args);
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
    const real = await realLocation(root, input.path);
    const realTarget = real.path;
    // A link can point out of the workspace after the request was presented as
    // staying in it. The approval that was given was for the contained read.
    if (inspected.effects?.reads !== "elsewhere" && real.scope !== "workspace")
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
    if (kind.named === pdfDocument)
      return readPdf({ target, realTarget, file }, input, signal, context);
    // An MP4 starts with its file-type box. The panel plays it; the model
    // is not sent its frames.
    if (
      extname(target).toLowerCase() === ".mp4" &&
      sample.subarray(4, 8).toString("latin1") === "ftyp"
    )
      return {
        ok: true,
        value: {
          path: target,
          kind: "video",
          bytes: file.size,
          note: "A video: the person can play it beside the conversation. Its frames are not sent to you.",
        },
        ...detailsOf(
          facts(["Video", target], ["Size", describeBytes(file.size)]),
        ),
      };
    if (kind.mediaType)
      return readPicture(
        { target, realTarget, file },
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
          inspected.effects?.reads === "elsewhere"
            ? `${target} was not found.`
            : `${input.path} was not found in this workspace.`,
      };
    if (isAbortError(error))
      return { ok: false, reason: "The document read was cancelled." };
    return { ok: false, reason: "The document could not be read." };
  }
}

/** What reading a document needs from the application. */
export type ReadDocumentNeeds = {
  /** Whether the model can be shown a picture, asked on every call. */
  readonly acceptsImages: (() => boolean) | undefined;
  readonly pdfPages: PdfPagesSource | undefined;
  readonly items: ConversationItems | undefined;
};

/** The document reader, as the registry offers it. */
export function readDocumentTool({
  acceptsImages,
  pdfPages,
  items,
}: ReadDocumentNeeds): ToolDefinition {
  return {
    spec: readDocumentSpec,
    // Offered without a folder only to look again at an attached picture.
    requiresWorkspace: items ? (args) => !readsAttachment(args) : true,
    inspect: async (args, _id, { root }) => inspectReadDocument(root, args),
    execute: (args, signal, conversationId, { root }) =>
      runReadDocument(root, args, signal, {
        acceptsImages: acceptsImages?.() ?? false,
        ...(pdfPages ? { pdfPages } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(items ? { items } : {}),
      }),
  };
}

function readsAttachment(args: unknown): boolean {
  const path = (args as { readonly path?: unknown } | undefined)?.path;
  return typeof path === "string" && keptAddress(path)?.kind === "attachment";
}
