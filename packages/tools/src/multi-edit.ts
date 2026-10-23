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
import { isAbsolute, relative, resolve } from "node:path";
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
  namesStream,
  normalizePath,
  toForwardSlashes,
} from "./workspace-path.js";
import { realStaysInside, staysInside } from "@zhiyin/workspace-containment";
import {
  decodeText,
  encodeText,
  findText,
  separateOccurrences,
  normalizeEndings,
  replaceLines,
  type DecodedText,
} from "./text-match.js";
import {
  largestChangedFile,
  tooLargeToChange,
  writeFileAtomically,
} from "./write-file.js";
import {
  noteOwnEdit,
  requireSeenFile,
  type FileSpan,
  type ReadStateContext,
} from "./file-read-state.js";

const maximumFiles = 20;
const maximumReplacements = 50;
const maximumQuoted = 60;
const maximumNamedTargets = 3;
/** Refuses bytes that are not UTF-8, and keeps a byte-order mark as read. */
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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
                      "Replace every occurrence instead of requiring exactly one; an occurrence that overlaps one already replaced is left as it is.",
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
  /** Where it really is, from the workspace folder. */
  readonly path: string;
  /** As the call named it. */
  readonly named: string;
  readonly absolute: string;
  /** The same for every name of one file, hard links included. */
  readonly identity: string;
  readonly decoded: DecodedText;
  readonly text: string;
  readonly replacements: number;
  readonly spans?: readonly FileSpan[];
};

type PlannedEdit = {
  readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
  readonly files: readonly ResolvedFile[];
};

type Refusal = Extract<ToolCallInspection, { readonly ok: false }>;

/**
 * A refusal the model can fix by aiming the edit differently. A repair on its
 * behalf may change only the inputs named: the text to find or the file, never
 * what the edit would put in it (ADR 0010).
 */
function correctable(reason: string, ...faulty: string[]): Refusal {
  return {
    ok: false,
    reason,
    correctable: true,
    ...(faulty.length ? { faulty } : {}),
  };
}

/** Where an edit's input sits in the call. */
const at = (file: number, replacement?: number) =>
  replacement === undefined
    ? `edits[${file}].path`
    : `edits[${file}].replacements[${replacement}].find`;

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

function describeTargets(paths: readonly string[]): string {
  if (paths.length === 1) return paths[0] as string;
  const named = paths.slice(0, maximumNamedTargets).join(", ");
  const remaining = paths.length - maximumNamedTargets;
  return `${paths.length} files: ${named}${remaining > 0 ? `, and ${remaining} more` : ""}`;
}

function count(noun: string, total: number): string {
  return `${total} ${noun}${total === 1 ? "" : "s"}`;
}

const numberedLine = /^\s*\d+→/;

/** A block every non-empty line of which starts the way read_file numbers it. */
function unnumbered(block: string): string | undefined {
  const lines = block.split("\n");
  const filled = lines.filter((line) => line.trim());
  if (!filled.length || !filled.every((line) => numberedLine.test(line)))
    return undefined;
  return lines.map((line) => line.replace(numberedLine, "")).join("\n");
}

/**
 * The replacement as it would read without the line numbers read_file shows,
 * when the text to find was copied with them. The replacement loses its
 * numbers too, or they would be written into the file.
 */
function withoutLineNumbers(
  replacement: Replacement,
): Pick<Replacement, "find" | "replace"> | undefined {
  const find = unnumbered(replacement.find);
  if (find === undefined) return undefined;
  return {
    find,
    replace: unnumbered(replacement.replace) ?? replacement.replace,
  };
}

/** The original lines a line of the text being edited stands for. */
type Origin = FileSpan;

/** The line, counted from 0, holding the character at `offset`. */
function lineHolding(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Where lines `from` to `to`, counted from 0, came from in the file as it was. */
function spanning(
  origins: readonly Origin[],
  from: number,
  to: number,
): Origin {
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (let line = from; line <= to; line += 1) {
    const origin = origins[line];
    if (!origin) continue;
    first = Math.min(first, origin.first);
    last = Math.max(last, origin.last);
  }
  return { first, last };
}

/**
 * Applies one file's replacements in order, each to the text the previous one
 * produced. Nothing here touches the disk: the caller decides whether the whole
 * edit is worth proposing before any of it is written.
 *
 * Every line a replacement touches is traced back to the original lines it
 * stands for, so the read it needs is of the lines it will really change, as
 * each is found after the ones before it. A line an earlier replacement wrote
 * stands for the lines that replacement changed, which already had to be read.
 * With a refusal come the lines established before it, or nothing when the
 * text to find was not found at all and only a complete read can stand for it.
 */
function applyReplacements(
  edit: FileEdit,
  original: string,
  file: number,
):
  | { readonly text: string; readonly spans: readonly FileSpan[] }
  | { readonly refusal: Refusal; readonly spans?: readonly FileSpan[] } {
  let lines = original.split("\n");
  let origins: Origin[] = lines.map((_, index) => ({
    first: index + 1,
    last: index + 1,
  }));
  const spans: FileSpan[] = [];
  const refused = (refusal: Refusal, seen: boolean) =>
    seen ? { refusal, spans: [...spans] } : { refusal };
  for (const [index, given] of edit.replacements.entries()) {
    let replacement = given;
    if (replacement.find === replacement.replace) {
      return refused(
        correctable(
          `A replacement in ${edit.path} puts back the same text. No file was changed.`,
        ),
        true,
      );
    }

    const text = lines.join("\n");
    let match = findText(text, replacement.find);
    const unnumbered = withoutLineNumbers(replacement);
    if (match.kind === "none" && unnumbered) {
      // Only after the text as sent was not found, so a file whose lines
      // really start with numbers is still edited exactly.
      const retried = findText(text, unnumbered.find);
      if (retried.kind !== "none") {
        match = retried;
        replacement = { ...replacement, ...unnumbered };
      }
    }
    if (match.kind === "unsearchable")
      return refused(
        correctable(`${edit.path}: ${match.reason} No file was changed.`),
        false,
      );
    if (match.kind === "none") {
      // The file itself is never quoted back: it has not been approved for
      // reading. A line number and a similarity are enough to retry from.
      const nearby = match.nearest
        ? ` The closest similar text is at line ${match.nearest.line}, sharing about ${Math.round(
            match.nearest.score * 100,
          )}% of the block.`
        : "";
      return refused(
        correctable(
          `${quoted(replacement.find)} was not found in ${edit.path}.${nearby} Read the file again and retry with its exact current text. No file was changed.`,
          at(file, index),
        ),
        false,
      );
    }

    const occurrences =
      match.kind === "exact" ? match.offsets.length : match.lines.length;
    const targets = replacement.replaceAll
      ? separateOccurrences(match, replacement.find)
      : match.kind === "exact"
        ? match.offsets.slice(0, 1)
        : match.lines.slice(0, 1);
    // Where each line starts in the text as it now is.
    const lineStarts = [0];
    for (const line of lines)
      lineStarts.push((lineStarts.at(-1) ?? 0) + line.length + 1);
    // Each target as the lines it rewrites in the text as it now is, and
    // those whose characters it changes: a find that ends a line rewrites the
    // next one without changing it.
    const findLines = replacement.find.split("\n").length;
    const touched = targets.map((start) => {
      if (match.kind === "flexible") {
        const last = start + match.lineCount - 1;
        return { start, first: start, last, changed: last };
      }
      const first = lineHolding(lineStarts, start);
      return {
        start,
        first,
        last: first + findLines - 1,
        changed: lineHolding(
          lineStarts,
          start + Math.max(replacement.find.length, 1) - 1,
        ),
      };
    });
    if (occurrences > 1 && !replacement.replaceAll) {
      const [only] = touched;
      if (only) spans.push(spanning(origins, only.first, only.changed));
      return refused(
        correctable(
          `${quoted(replacement.find)} appears ${occurrences} times in ${edit.path}. Include surrounding text to make it unique, or set replaceAll. No file was changed.`,
          at(file, index),
        ),
        true,
      );
    }

    // Targets that touch the same lines are rewritten together, as one
    // piece of the lines they share.
    const groups: (typeof touched)[] = [];
    for (const target of touched) {
      const group = groups.at(-1);
      if (group && target.first <= (group.at(-1)?.last ?? -1))
        group.push(target);
      else groups.push([target]);
    }
    const nextLines: string[] = [];
    const nextOrigins: Origin[] = [];
    const keep = (from: number, to: number) => {
      for (let line = from; line < to; line += 1) {
        nextLines.push(lines[line] ?? "");
        nextOrigins.push(origins[line] ?? { first: line + 1, last: line + 1 });
      }
    };
    let kept = 0;
    for (const group of groups) {
      const first = group[0]?.first ?? 0;
      let last = first;
      let changed = first;
      for (const target of group) {
        last = Math.max(last, target.last);
        changed = Math.max(changed, target.changed);
      }
      keep(kept, first);
      let segment = lines.slice(first, last + 1).join("\n");
      if (match.kind === "exact") {
        const base = lineStarts[first] ?? 0;
        const pieces: string[] = [];
        let from = 0;
        for (const target of group) {
          const at = target.start - base;
          pieces.push(segment.slice(from, at), replacement.replace);
          from = at + replacement.find.length;
        }
        pieces.push(segment.slice(from));
        segment = pieces.join("");
      } else {
        segment = replaceLines(
          segment,
          0,
          match.lineCount,
          replacement.replace,
        );
      }
      const origin = spanning(origins, first, changed);
      spans.push(origin);
      // A find that ends a line leaves the next one unchanged at the end of
      // the piece: it keeps its own origin when it still stands alone, and
      // carries both when the replacement runs on into it.
      const ending =
        last === changed
          ? origin
          : replacement.replace.endsWith("\n")
            ? (origins[last] ?? { first: last + 1, last: last + 1 })
            : spanning(origins, first, last);
      const rewritten = segment.split("\n");
      rewritten.forEach((line, index) => {
        nextLines.push(line);
        nextOrigins.push(index === rewritten.length - 1 ? ending : origin);
      });
      kept = last + 1;
    }
    keep(kept, lines.length);
    lines = nextLines;
    origins = nextOrigins;
  }

  const text = lines.join("\n");
  if (text === original) {
    return refused(
      correctable(
        `The replacements for ${edit.path} would change nothing. No file was changed.`,
      ),
      true,
    );
  }
  return { text, spans };
}

async function planMultiEdit(
  root: string,
  args: unknown,
  signal?: AbortSignal,
  context: ReadStateContext = {},
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
    if (
      isAbsolute(edit.path) ||
      namesStream(edit.path) ||
      !staysInside(root, resolve(root, edit.path))
    ) {
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

  for (const [file, edit] of input.edits.entries()) {
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
          at(file),
        );
      }
      return correctable(
        `${edit.path} could not be opened before editing. Check that it is readable.`,
      );
    }
    if (!realStaysInside(realRoot, absolute)) {
      return {
        ok: false,
        reason: "Every edited file must stay inside the current workspace.",
      };
    }
    // Named by where it really is, so two spellings of one file are one file.
    const path = toForwardSlashes(relative(realRoot, absolute));
    let identity: string;
    try {
      const entry = await stat(absolute, { bigint: true });
      if (!entry.isFile()) {
        return correctable(
          `${edit.path} is a folder in this workspace, not a file.`,
          at(file),
        );
      }
      // Checked before anything of the file is loaded.
      if (entry.size > BigInt(largestChangedFile))
        return correctable(tooLargeToChange(edit.path), at(file));
      identity = `${entry.dev}:${entry.ino}`;
    } catch {
      return correctable(
        `${edit.path} could not be opened before editing. Check that it is readable.`,
      );
    }
    // A hard link is a second name for one file, which realpath keeps apart.
    const twin = files.find(
      (planned) =>
        planned.absolute === absolute || planned.identity === identity,
    );
    if (twin)
      return correctable(
        `${edit.path} is the same file as ${twin.named}. Put every replacement for one file in a single entry.`,
      );

    let bytes: Buffer;
    try {
      bytes = await readFile(absolute);
    } catch {
      return correctable(
        `${edit.path} could not be read before editing. Check that it is a text file.`,
      );
    }
    // Text that is not UTF-8 would be written back as UTF-8, changing every
    // character it holds outside ASCII, the untouched ones included.
    let raw: string;
    try {
      raw = utf8.decode(bytes);
    } catch {
      return {
        ok: false,
        reason: `${edit.path} is not UTF-8 text, so an edit would change characters it does not touch. No file was changed.`,
      };
    }
    const decoded = decodeText(raw);
    const applied = applyReplacements(edit, decoded.text, file);
    const unseen = await requireSeenFile(
      absolute,
      path,
      context,
      applied.spans,
    );
    if (unseen) return unseen;
    if ("refusal" in applied) return applied.refusal;
    const { spans } = applied;
    files.push({
      path,
      named: edit.path,
      absolute,
      identity,
      decoded,
      text: applied.text,
      replacements: edit.replacements.length,
      spans,
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
      target: describeTargets(files.map((planned) => planned.path)),
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
  context: ReadStateContext = {},
): Promise<ToolCallInspection> {
  const planned = await planMultiEdit(root, args, undefined, context);
  return "inspection" in planned ? planned.inspection : planned;
}

export async function runMultiEdit(
  root: string,
  args: unknown,
  signal?: AbortSignal,
  context: ReadStateContext = {},
): Promise<ToolInvocationResult> {
  // Resolved again rather than carried over from inspection: the file may have
  // changed while the request waited, and this is what decides that it did.
  const planned = await planMultiEdit(root, args, signal, context);
  if (!("inspection" in planned)) return planned;

  const produced: ProducedFile[] = [];
  // What was written before a failure stays declared, so it is still shown.
  const written = () => (produced.length ? { produced: [...produced] } : {});
  for (const file of planned.files) {
    const encoded = encodeText(file.decoded, file.text);
    try {
      signal?.throwIfAborted();
      const unseen = await requireSeenFile(
        file.absolute,
        file.path,
        context,
        file.spans,
      );
      if (unseen)
        return {
          ok: false,
          reason: `${unseen.reason} ${produced.length ? `Earlier files changed: ${produced.map((item) => item.path).join(", ")}.` : "No file was changed."}`,
          ...written(),
        };
      await writeFileAtomically(file.absolute, encoded, signal);
      await noteOwnEdit(
        file.absolute,
        file.decoded.text,
        file.text,
        encoded,
        context,
      );
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
        ...written(),
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
