/**
 * Reads several workspace files in one call.
 *
 * Looking at a handful of small files is a common first move, and one call per
 * file spends a request, and the call's own words, on each. Here they are read
 * together and answered together. They share what one answer may hold, so a
 * batch never arrives cut in the middle and saved elsewhere; a file that did
 * not fit says which line to continue from with read_file.
 *
 * Only workspace files, so the batch never needs anyone's approval: reading
 * past the folder stays a single, separately decided read_file.
 */

import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf } from "./action-detail.js";
import { keptAddress } from "./conversation-items.js";
import {
  inspectReadTextFile,
  runReadTextFile,
  type ReadContext,
} from "./read-file.js";
import { normalizePath } from "./workspace-path.js";

const maximumFiles = 10;
/**
 * What the files share: one result's allowance less room for the answer's own
 * structure, so the batch arrives whole.
 */
const sharedTokens = 7_200;

export const readFilesSpec: ToolSpec = {
  access: "read",
  name: "read_files",
  description: `Read several text files in the current workspace in one call, up to ${maximumFiles}. Use it instead of several read_file calls when you already know which files you want. The files share one answer's length, so each long one is cut and says which startLine to continue from with read_file. For a file outside the workspace, or a chosen stretch of lines, use read_file. PDFs and pictures are read with read_document.`,
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: maximumFiles,
        description:
          "Workspace-relative paths of the files, or output:// and attachment:// ids, in the order to read them.",
      },
    },
    required: ["paths"],
    additionalProperties: false,
  },
};

type Checked =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly reason: string };

function checked(root: string, args: unknown): Checked {
  const wrong = {
    ok: false,
    reason: `Name between 1 and ${maximumFiles} files to read, each once.`,
  } as const;
  if (!args || typeof args !== "object" || Array.isArray(args)) return wrong;
  const source = args as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "paths")) return wrong;
  const given = source["paths"];
  if (!Array.isArray(given) || !given.length || given.length > maximumFiles)
    return wrong;
  if (given.some((path) => typeof path !== "string" || !path.trim()))
    return wrong;
  const paths = (given as string[]).map((path) =>
    keptAddress(path) ? path.trim() : normalizePath(path),
  );
  if (new Set(paths).size !== paths.length) return wrong;
  for (const path of paths) {
    const one = inspectReadTextFile(root, { path });
    if (one.ok && one.scope !== "workspace")
      return {
        ok: false,
        reason: `read_files reads only inside the workspace; read ${path} with read_file.`,
      };
  }
  return { ok: true, paths };
}

export function inspectReadFiles(
  root: string,
  args: unknown,
): ToolCallInspection {
  const input = checked(root, args);
  if (!input.ok) return { ...input, correctable: true };
  return {
    ok: true,
    action:
      input.paths.length === 1
        ? "Read a workspace file"
        : `Read ${input.paths.length} workspace files`,
    target: input.paths.join(", "),
    access: "read",
    scope: "workspace",
    command: `read_files(${JSON.stringify({ paths: input.paths })})`,
  };
}

type FileAnswer = { readonly path: string } & Record<string, unknown>;

export async function runReadFiles(
  root: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: ReadContext,
): Promise<ToolInvocationResult> {
  const input = checked(root, args);
  if (!input.ok) return input;
  const tokens = Math.floor(sharedTokens / input.paths.length);
  const files: FileAnswer[] = [];
  for (const path of input.paths) {
    const read = await runReadTextFile(root, { path }, signal, {
      ...context,
      tokens,
    });
    files.push(
      read.ok
        ? { ...(read.value as Record<string, unknown>), path }
        : { path, error: read.reason },
    );
    if (signal?.aborted)
      return { ok: false, reason: "The file reads were cancelled." };
  }
  const failed = files.filter((file) => "error" in file);
  if (failed.length === files.length)
    return {
      ok: false,
      reason: failed.map((file) => String(file["error"])).join(" "),
    };
  return {
    ok: true,
    value: { files },
    ...detailsOf({
      kind: "list",
      label: `${files.length - failed.length} of ${files.length} read`,
      items: files.map((file) =>
        "error" in file
          ? `${file.path}: ${String(file["error"])}`
          : `${file.path}${typeof file["lines"] === "string" ? ` (lines ${file["lines"]} of ${String(file["totalLines"])})` : ""}`,
      ),
    }),
  };
}
