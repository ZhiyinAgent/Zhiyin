/**
 * Applies exact text replacements across one or more existing workspace files
 * as a single reviewed action.
 *
 * The whole edit is resolved while it is being *inspected*, before anyone is
 * asked to approve it: every file is read, every replacement located, and the
 * resulting text computed in memory. A proposal that cannot be applied
 * therefore fails before it reaches a person, marked as something the model can
 * fix by itself. Nobody should have to read a permission request for an edit
 * that was never going to work.
 *
 * A replacement that matches nothing, matches more than one place, or puts back
 * the text already present is a failure with a reason. Guessing which
 * occurrence was meant, or reporting a no-op as done, would leave the agent
 * believing it changed something it did not.
 */

import { detailsOf, facts } from "./action-detail.js";
import { describeChange } from "./file-change.js";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type {
  ProducedFile,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import {
  describeCommand,
  errorCode,
  isAbortError,
  normalizePath,
  staysInside,
} from "./workspace-path.js";
import {
  decodeText,
  encodeText,
  findText,
  normalizeEndings,
  replaceLines,
  type DecodedText,
} from "./text-match.js";
import { writeFileAtomically } from "./write-file.js";

const maximumFiles = 20;
const maximumReplacements = 50;
const maximumQuoted = 60;
const maximumNamedTargets = 3;

export const multiEditSpec: ToolSpec = {
  name: "multi_edit",
  description:
    "Replace exact text in one or more files that already exist in the current workspace. Each replacement must match exactly one place unless replaceAll is set. Line endings, a byte-order mark, trailing whitespace, and the indentation of a whole block are matched flexibly; the words themselves must match. Either every replacement applies or none does.",
  inputSchema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        minItems: 1,
        maxItems: maximumFiles,
        description: "One entry per file. List each file at most once.",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative path of an existing file.",
            },
            replacements: {
              type: "array",
              minItems: 1,
              maxItems: maximumReplacements,
              description: "Applied in order to that file.",
              items: {
                type: "object",
                properties: {
                  find: {
                    type: "string",
                    description:
                      "Exact text to replace, including enough surrounding text to occur only once.",
                  },
                  replace: {
                    type: "string",
                    description: "Exact text to put in its place.",
                  },
                  replaceAll: {
                    type: "boolean",
                    description:
                      "Replace every occurrence instead of requiring exactly one.",
                  },
                },
                required: ["find", "replace"],
                additionalProperties: false,
              },
            },
          },
          required: ["path", "replacements"],
          additionalProperties: false,
        },
      },
    },
    required: ["edits"],
    additionalProperties: false,
  },
};

type Replacement = {
  readonly find: string;
  readonly replace: string;
  readonly replaceAll: boolean;
};

type FileEdit = {
  readonly path: string;
  readonly replacements: readonly Replacement[];
};

type EditArguments = { readonly edits: readonly FileEdit[] };

type ResolvedFile = {
  readonly path: string;
  readonly absolute: string;
  readonly decoded: DecodedText;
  readonly text: string;
  readonly replacements: number;
};

type PlannedEdit = {
  readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
  readonly files: readonly ResolvedFile[];
};

type Refusal = Extract<ToolCallInspection, { readonly ok: false }>;

/**
 * A refusal the model — or a repair on its behalf — can fix by aiming the edit
 * differently. `replace` is named as untouchable: re-aiming an edit is a
 * correction, rewriting what it would put in the file is a different edit that
 * nobody proposed.
 */
function correctable(reason: string): Refusal {
  return {
    ok: false,
    reason,
    correctable: true,
    preserveOnRepair: ["replace"],
  };
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => allowed.includes(key));
}

function replacementFrom(value: unknown): Replacement | undefined {
  if (!hasOnlyKeys(value, ["find", "replace", "replaceAll"])) return;
  const source = value as Record<string, unknown>;
  if (typeof source["find"] !== "string" || !source["find"]) return;
  if (typeof source["replace"] !== "string") return;
  const replaceAll = source["replaceAll"] ?? false;
  if (typeof replaceAll !== "boolean") return;
  return {
    // A model's text arrives with whatever endings it chose; the file's own
    // conventions are restored when it is written back.
    find: normalizeEndings(source["find"]),
    replace: normalizeEndings(source["replace"]),
    replaceAll,
  };
}

function editArguments(args: unknown): EditArguments | undefined {
  if (!hasOnlyKeys(args, ["edits"])) return;
  const source = (args as Record<string, unknown>)["edits"];
  if (!Array.isArray(source) || !source.length || source.length > maximumFiles)
    return;

  const edits: FileEdit[] = [];
  for (const entry of source) {
    if (!hasOnlyKeys(entry, ["path", "replacements"])) return;
    const file = entry as Record<string, unknown>;
    if (typeof file["path"] !== "string" || !file["path"].trim()) return;
    const list = file["replacements"];
    if (
      !Array.isArray(list) ||
      !list.length ||
      list.length > maximumReplacements
    )
      return;
    const replacements: Replacement[] = [];
    for (const item of list) {
      const replacement = replacementFrom(item);
      if (!replacement) return;
      replacements.push(replacement);
    }
    edits.push({ path: normalizePath(file["path"]), replacements });
  }
  return { edits };
}

function quoted(value: string): string {
  const shown =
    value.length > maximumQuoted ? `${value.slice(0, maximumQuoted)}…` : value;
  return `“${shown.replaceAll("\n", "⏎")}”`;
}

function describeTargets(edits: readonly FileEdit[]): string {
  const paths = edits.map((edit) => edit.path);
  if (paths.length === 1) return paths[0] as string;
  const named = paths.slice(0, maximumNamedTargets).join(", ");
  const remaining = paths.length - maximumNamedTargets;
  return `${paths.length} files: ${named}${remaining > 0 ? `, and ${remaining} more` : ""}`;
}

function count(noun: string, total: number): string {
  return `${total} ${noun}${total === 1 ? "" : "s"}`;
}

/**
 * Applies one file's replacements in order, each to the text the previous one
 * produced. Nothing here touches the disk: the caller decides whether the whole
 * edit is worth proposing before any of it is written.
 */
function applyReplacements(
  edit: FileEdit,
  original: string,
): { readonly text: string } | Refusal {
  let text = original;
  for (const replacement of edit.replacements) {
    if (replacement.find === replacement.replace) {
      return correctable(
        `A replacement in ${edit.path} puts back the same text. No file was changed.`,
      );
    }

    const match = findText(text, replacement.find);
    if (match.kind === "unsearchable")
      return correctable(`${edit.path}: ${match.reason} No file was changed.`);
    if (match.kind === "none") {
      // The file itself is never quoted back: it has not been approved for
      // reading. A line number and a similarity are enough to retry from.
      const nearby = match.nearest
        ? ` The closest similar text is at line ${match.nearest.line}, sharing about ${Math.round(
            match.nearest.score * 100,
          )}% of the block.`
        : "";
      return correctable(
        `${quoted(replacement.find)} was not found in ${edit.path}.${nearby} Read the file again and retry with its exact current text. No file was changed.`,
      );
    }

    const occurrences =
      match.kind === "exact" ? match.offsets.length : match.lines.length;
    if (occurrences > 1 && !replacement.replaceAll) {
      return correctable(
        `${quoted(replacement.find)} appears ${occurrences} times in ${edit.path}. Include surrounding text to make it unique, or set replaceAll. No file was changed.`,
      );
    }

    if (match.kind === "exact") {
      const targets = replacement.replaceAll
        ? match.offsets
        : [match.offsets[0] as number];
      // Last to first, so an earlier offset is never invalidated by an
      // edit made after it.
      for (const offset of [...targets].reverse()) {
        text = `${text.slice(0, offset)}${replacement.replace}${text.slice(
          offset + replacement.find.length,
        )}`;
      }
    } else {
      const targets = replacement.replaceAll
        ? match.lines
        : [match.lines[0] as number];
      for (const line of [...targets].reverse()) {
        text = replaceLines(text, line, match.lineCount, replacement.replace);
      }
    }
  }

  if (text === original) {
    return correctable(
      `The replacements for ${edit.path} would change nothing. No file was changed.`,
    );
  }
  return { text };
}

async function planMultiEdit(
  root: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<PlannedEdit | Refusal> {
  const input = editArguments(args);
  if (!input) {
    return correctable(
      "Describe each file to edit and the exact text to replace in it. Every file needs at least one replacement.",
    );
  }

  const seen = new Set<string>();
  for (const edit of input.edits) {
    if (seen.has(edit.path)) {
      return correctable(
        `${edit.path} is listed twice. Put every replacement for one file in a single entry.`,
      );
    }
    seen.add(edit.path);
    if (isAbsolute(edit.path) || !staysInside(root, resolve(root, edit.path))) {
      // Not correctable: leaving the workspace is a refusal a person sees.
      return {
        ok: false,
        reason: "Every edited file must stay inside the current workspace.",
      };
    }
  }

  const files: ResolvedFile[] = [];
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return {
      ok: false,
      reason: "The current workspace folder could not be opened.",
    };
  }

  for (const edit of input.edits) {
    if (signal?.aborted)
      return {
        ok: false,
        reason: "The edit was not prepared; the task stopped.",
      };
    let absolute: string;
    try {
      absolute = await realpath(resolve(realRoot, edit.path));
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return correctable(
          `${edit.path} was not found in this workspace. multi_edit only changes files that already exist.`,
        );
      }
      return correctable(
        `${edit.path} could not be opened before editing. Check that it is readable.`,
      );
    }
    if (!staysInside(realRoot, absolute)) {
      return {
        ok: false,
        reason: "Every edited file must stay inside the current workspace.",
      };
    }
    try {
      if (!(await stat(absolute)).isFile()) {
        return correctable(
          `${edit.path} is a folder in this workspace, not a file.`,
        );
      }
    } catch {
      return correctable(
        `${edit.path} could not be opened before editing. Check that it is readable.`,
      );
    }

    let raw: string;
    try {
      raw = await readFile(absolute, "utf8");
    } catch {
      return correctable(
        `${edit.path} could not be read before editing. Check that it is a text file.`,
      );
    }
    const decoded = decodeText(raw);
    const applied = applyReplacements(edit, decoded.text);
    if ("ok" in applied) return applied;
    files.push({
      path: edit.path,
      absolute,
      decoded,
      text: applied.text,
      replacements: edit.replacements.length,
    });
  }

  const replacements = input.edits.reduce(
    (total, edit) => total + edit.replacements.length,
    0,
  );
  return {
    files,
    inspection: {
      ok: true,
      action:
        input.edits.length === 1
          ? "Edit a workspace file"
          : "Edit workspace files",
      target: describeTargets(input.edits),
      access: "change",
      scope: "workspace",
      changes: files.map((file) =>
        describeChange(file.path, "updated", file.text, file.decoded.text),
      ),
      detail: `This applies ${count("replacement", replacements)} to ${count(
        "existing file",
        input.edits.length,
      )}. Nothing else is changed.`,
      command: describeCommand(multiEditSpec.name, input),
    },
  };
}

export async function inspectMultiEdit(
  root: string,
  args: unknown,
): Promise<ToolCallInspection> {
  const planned = await planMultiEdit(root, args);
  return "inspection" in planned ? planned.inspection : planned;
}

export async function runMultiEdit(
  root: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<ToolInvocationResult> {
  // Resolved again rather than carried over from inspection: the file may have
  // changed while the request waited, and this is what decides that it did.
  const planned = await planMultiEdit(root, args, signal);
  if (!("inspection" in planned)) return planned;

  const produced: ProducedFile[] = [];
  for (const file of planned.files) {
    const encoded = encodeText(file.decoded, file.text);
    try {
      signal?.throwIfAborted();
      await writeFileAtomically(file.absolute, encoded, signal);
    } catch (error) {
      const changed = produced.map((item) => item.path);
      const untouched = planned.files
        .map((item) => item.path)
        .filter((path) => !changed.includes(path));
      const stopped = isAbortError(error);
      return {
        ok: false,
        reason: `${file.path} ${stopped ? "was not written; the task stopped" : "could not be written"}. ${
          changed.length
            ? `These files were already changed: ${changed.join(", ")}. These were not: ${untouched.join(", ")}.`
            : "No file was changed."
        }`,
      };
    }
    produced.push({
      path: file.path,
      change: "updated",
      bytes: Buffer.byteLength(encoded, "utf8"),
    });
  }

  return {
    ok: true,
    value: {
      files: planned.files.map((file) => ({
        path: file.path,
        replacements: file.replacements,
      })),
    },
    produced,
    ...detailsOf(
      facts(
        ...planned.files.map(
          (file) =>
            [file.path, count("replacement", file.replacements)] as const,
        ),
      ),
    ),
  };
}
