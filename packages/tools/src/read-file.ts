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

import { open, readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts, textDetail } from "./action-detail.js";
import { boundedFileText, fileKind } from "./file-content.js";
import { parsePageRange, readPdfText, renderPdfPages } from "./read-pdf.js";
import {
  describeBytes,
  errorCode,
  isAbortError,
  normalizePath,
  scopeOf,
  toForwardSlashes,
  type PathScope,
} from "./workspace-path.js";

const maximumBytes = 2 * 1024 * 1024;
/**
 * How much of a file's text one answer carries. A file is allowed to be larger
 * than a turn can hold; what is not allowed is silently pretending it was not.
 */
const maximumTextCharacters = 60_000;
/** Enough of the head to tell text from anything else. */
const sampleBytes = 4096;

export const readFileSpec: ToolSpec = {
  name: "read_file",
  description:
    "Read one text file, or the text of one PDF. A workspace-relative path reads a file in the current workspace; an absolute path may read a file elsewhere on this computer, which the person is asked about first. A very long file is shortened from the middle, and a long PDF is read a stretch of pages at a time. Images are not read here — use read_image.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Workspace-relative path of the file to read, or an absolute path for a file outside the workspace.",
      },
      pages: {
        type: "string",
        description:
          'PDF only: which pages to read, as "4" or "2-9". Defaults to as many as fit from the first page.',
      },
      as: {
        type: "string",
        enum: ["text", "image"],
        description:
          'PDF only: "text" reads the words, and is the default. "image" draws the pages and shows them, for a scanned document or one whose layout matters. Two pages at a time.',
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
  if (!args || typeof args !== "object" || Array.isArray(args))
    return undefined;
  const source = args as Record<string, unknown>;
  if (
    Object.keys(source).some(
      (key) => key !== "path" && key !== "pages" && key !== "as",
    )
  )
    return undefined;
  const path = source["path"];
  if (typeof path !== "string" || !path.trim()) return undefined;
  const pages = source["pages"];
  if (pages !== undefined && typeof pages !== "string") return undefined;
  const shape = source["as"];
  if (shape !== undefined && shape !== "text" && shape !== "image")
    return undefined;
  return {
    path: normalizePath(path),
    ...(pages === undefined ? {} : { pages }),
    ...(shape === undefined ? {} : { as: shape }),
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
  const absolute = resolve(root, input.path);
  const scope: PathScope = scopeOf(root, absolute);
  const command = `read_file(${JSON.stringify({
    path: input.path,
    ...(input.pages === undefined ? {} : { pages: input.pages }),
    ...(input.as === undefined ? {} : { as: input.as }),
  })})`;
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

export async function runReadTextFile(
  root: string,
  args: unknown,
  signal?: AbortSignal,
  /** Whether the model this is read for can be shown a picture. */
  acceptsImages = false,
): Promise<ToolInvocationResult> {
  const inspected = inspectReadTextFile(root, args);
  if (!inspected.ok) return inspected;
  const input = readArguments(args);
  if (!input) return { ok: false, reason: "The file path is invalid." };

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
    if (file.size > maximumBytes) {
      return {
        ok: false,
        reason: "The file is too large to read in one tool call.",
      };
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
    // A PDF is the one binary a person routinely means by "read this file", so
    // it is read rather than refused. Everything else that is not text is
    // refused with what it actually is, and where to take it instead.
    if (kind.kind === "binary" && kind.named === "a PDF document") {
      const range = parsePageRange(input.pages);
      if (range === "invalid")
        return {
          ok: false,
          reason:
            'Ask for pages as a single number, like "4", or a range, like "2-9".',
        };
      const bytes = await readFile(realTarget, signal ? { signal } : {});
      if (input.as === "image") {
        if (!acceptsImages)
          return {
            ok: false,
            reason:
              "This model cannot be shown pictures, so a page cannot be drawn for it. Read the text instead.",
          };
        const drawn = await renderPdfPages(bytes, range, signal);
        if (!drawn.ok) return drawn;
        const shown =
          drawn.read.first === drawn.read.last
            ? String(drawn.read.first)
            : `${drawn.read.first}-${drawn.read.last}`;
        return {
          ok: true,
          value: {
            path: inspected.target,
            pages: drawn.pages,
            pagesRead: shown,
            ...(drawn.complete
              ? {}
              : {
                  truncated: true,
                  more: `Drawn ${shown} of ${drawn.pages} pages. Ask for the rest with pages: "${drawn.read.last + 1}-${Math.min(drawn.read.last + 2, drawn.pages)}".`,
                }),
          },
          images: drawn.images,
          ...detailsOf(
            facts(
              ["File", inspected.target],
              ["Size", describeBytes(file.size)],
              ["Pages drawn", `${shown} of ${drawn.pages}`],
            ),
          ),
        };
      }
      const read = await readPdfText(bytes, range, signal);
      if (!read.ok) return read;
      const pagesRead =
        read.read.first === read.read.last
          ? String(read.read.first)
          : `${read.read.first}-${read.read.last}`;
      return {
        ok: true,
        value: {
          path: inspected.target,
          text: read.text,
          pages: read.pages,
          pagesRead,
          ...(read.complete ? {} : { truncated: true }),
        },
        ...detailsOf(
          facts(
            ["File", inspected.target],
            ["Size", describeBytes(file.size)],
            ["Pages", `${pagesRead} of ${read.pages}`],
          ),
          textDetail("Contents", read.text, !read.complete),
        ),
      };
    }
    if (input.as === "image")
      return {
        ok: false,
        reason: `Only a PDF can be drawn as a picture. ${inspected.target} is ${
          kind.kind === "text" ? "a text file" : (kind.named ?? "not a PDF")
        }${kind.kind === "binary" && kind.mediaType ? "; use read_image to look at it" : ""}.`,
      };
    if (kind.kind === "binary") {
      return {
        ok: false,
        reason: kind.mediaType
          ? `${inspected.target} is ${kind.named}. Use read_image to look at it.`
          : `${inspected.target} is not a text file${kind.named ? ` — it is ${kind.named}` : ""}. Reading it as text would produce nothing meaningful.`,
      };
    }
    const whole = await readFile(realTarget, {
      encoding: "utf8",
      ...(signal ? { signal } : {}),
    });
    const bounded = boundedFileText(whole, maximumTextCharacters);
    return {
      ok: true,
      value: {
        path: inspected.target,
        text: bounded.text,
        ...(bounded.truncated ? { truncated: true } : {}),
      },
      ...detailsOf(
        facts(["File", inspected.target], ["Size", describeBytes(file.size)]),
        textDetail("Contents", bounded.text, bounded.truncated),
      ),
    };
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
