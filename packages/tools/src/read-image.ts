/**
 * Looks at one image file.
 *
 * Separate from reading text, because the answer travels differently: an image
 * is not something the model reads, it is something the model is shown, and it
 * reaches it on its own channel rather than encoded into a result. Everything
 * else — how the path is bounded, when a person is asked — is the same as any
 * other read, and is settled the same way.
 *
 * Offered only where it can work. A model that accepts no images would get a
 * tool whose whole answer it cannot see, which is not a capability.
 */

import { open, readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts } from "./action-detail.js";
import { fileKind } from "./file-content.js";
import { imageSize } from "./image-size.js";
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
 * Z.AI documents 5 MB per image for `image_url` content (verified 2026-09-09).
 * Bounded below that: base64 adds a third again on the way out, and the file
 * has to survive being carried alongside everything else in the request.
 */
const maximumImageBytes = 3 * 1024 * 1024;
/**
 * Enough of the head to name the kind and read the size out of it. A JPEG
 * keeps its dimensions after whatever metadata it carries, and an EXIF block
 * with a thumbnail in it runs to tens of kilobytes.
 */
const sampleBytes = 128 * 1024;

export const readImageSpec: ToolSpec = {
  name: "read_image",
  description:
    "Look at one image file — PNG, JPEG, WebP, GIF or BMP. Use this instead of read_file for pictures: the image is shown directly rather than read as text. A workspace-relative path opens a file in the current workspace; an absolute path may open one elsewhere on this computer, which the person is asked about first.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Workspace-relative path of the image to look at, or an absolute path for one outside the workspace.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

type ReadArguments = { readonly path: string };

function readArguments(args: unknown): ReadArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args))
    return undefined;
  const entries = Object.entries(args);
  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== "path" ||
    typeof entries[0][1] !== "string" ||
    !entries[0][1].trim()
  )
    return undefined;
  return { path: normalizePath(entries[0][1]) };
}

export function inspectReadImage(
  root: string,
  args: unknown,
): ToolCallInspection {
  const input = readArguments(args);
  if (!input)
    return {
      ok: false,
      correctable: true,
      reason: "Choose an image to look at.",
    };
  const scope = scopeOf(root, resolve(root, input.path));
  const target = toForwardSlashes(
    scope === "workspace" ? input.path : resolve(root, input.path),
  );
  return {
    ok: true,
    action:
      scope === "workspace"
        ? "Look at a workspace image"
        : "Look at an image outside the workspace",
    target,
    ...(scope === "workspace"
      ? {}
      : {
          detail:
            "This image is outside the selected folder. What it shows becomes part of this conversation.",
        }),
    access: "read",
    scope,
    command: describeCommand(readImageSpec.name, { path: input.path }),
  };
}

export async function runReadImage(
  root: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<ToolInvocationResult> {
  const inspected = inspectReadImage(root, args);
  if (!inspected.ok) return inspected;
  const input = readArguments(args);
  if (!input) return { ok: false, reason: "The file path is invalid." };

  try {
    const [realRoot, realTarget] = await Promise.all([
      realpath(root),
      realpath(resolve(root, input.path)),
    ]);
    // The same rule as any other read: a link may not turn a contained action
    // into an uncontained one after it was presented as contained.
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
    if (file.size > maximumImageBytes)
      return {
        ok: false,
        reason: `This image is ${describeBytes(file.size)}, which is too large to send. Images must be under ${describeBytes(maximumImageBytes)}.`,
      };

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
    if (kind.kind !== "binary" || !kind.mediaType)
      return {
        ok: false,
        reason: `${inspected.target} is not an image${kind.kind === "text" ? " — it is text. Use read_file to read it." : ". Use read_file if it is text."}`,
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
      value: {
        path: inspected.target,
        mediaType: kind.mediaType,
        bytes: file.size,
      },
      images: [{ mediaType: kind.mediaType, data: bytes.toString("base64") }],
      ...detailsOf(
        facts(
          ["Image", inspected.target],
          ["Kind", kind.named ?? kind.mediaType],
          ...(size
            ? ([["Pixels", `${size.width} × ${size.height}`]] as const)
            : []),
          ["Size", describeBytes(file.size)],
        ),
      ),
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return {
        ok: false,
        reason:
          inspected.scope === "outside"
            ? `${inspected.target} was not found.`
            : `${input.path} was not found in this workspace.`,
      };
    if (isAbortError(error))
      return { ok: false, reason: "Opening the image was cancelled." };
    return { ok: false, reason: "The image could not be opened." };
  }
}
