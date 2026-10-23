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
import { estimatedTokens } from "@zhiyin/contract";
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
 * What the files share of one answer: nine tenths, the rest kept for the
 * answer's own structure, so the batch arrives whole.
 */
const sharedShare = 0.9;
/** The answer shared when the caller does not say, one page's worth. */
const defaultAnswerTokens = 8_000;

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

/**
 * A file that cannot be read keeps to its share of the answer as a page does:
 * its reason, which often repeats its path, is cut to fit, and the path too
 * when it alone is longer.
 */
function withinShare(path: string, reason: string, tokens: number): FileAnswer {
  const fits = (answer: FileAnswer) =>
    estimatedTokens(JSON.stringify(answer)) <= tokens;
  const cut = (text: string, keep: number) =>
    keep >= text.length ? text : `${text.slice(0, Math.max(keep, 0))}…`;
  const longest = (make: (keep: number) => FileAnswer, length: number) => {
    let low = 0;
    let high = length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(make(middle))) low = middle;
      else high = middle - 1;
    }
    return make(low);
  };
  const whole = { path, error: reason };
  if (fits(whole)) return whole;
  const reasoned = longest(
    (keep) => ({ path, error: cut(reason, keep) }),
    reason.length,
  );
  if (fits(reasoned)) return reasoned;
  return longest(
    (keep) => ({ path: cut(path, keep), error: "…" }),
    path.length,
  );
}

export async function runReadFiles(
  root: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: ReadContext,
): Promise<ToolInvocationResult> {
  const input = checked(root, args);
  if (!input.ok) return input;
  const tokens = Math.floor(
    ((context.tokens ?? defaultAnswerTokens) * sharedShare) /
      input.paths.length,
  );
  const files: FileAnswer[] = [];
  const reasons: string[] = [];
  for (const path of input.paths) {
    const read = await runReadTextFile(root, { path }, signal, {
      ...context,
      tokens,
    });
    if (!read.ok) reasons.push(read.reason);
    files.push(
      read.ok
        ? { ...(read.value as Record<string, unknown>), path }
        : withinShare(path, read.reason, tokens),
    );
    if (signal?.aborted)
      return { ok: false, reason: "The file reads were cancelled." };
  }
  const failed = files.filter((file) => "error" in file);
  // Nothing read, nothing counts as read: each reason is said whole.
  if (failed.length === files.length)
    return { ok: false, reason: reasons.join(" ") };
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
