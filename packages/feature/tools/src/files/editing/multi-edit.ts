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

import { detailsOf, facts } from "../../shared/action-detail.js";
import { describeChange } from "./file-change.js";
import { editedLines } from "./edited-lines.js";
import { changingFiles } from "../../shared/effects.js";
import { schemaInput, withSchemaProblems } from "@zhiyin/tool-input";
import { shortened } from "@zhiyin/text-and-names";
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
} from "../../shared/workspace-path.js";
import {
  placeOutside,
  realStaysInside,
  staysInside,
} from "@zhiyin/workspace-containment";
import {
  decodeText,
  encodeText,
  findText,
  maximumPatternLines,
  maximumSearchLines,
  separateOccurrences,
  normalizeEndings,
  replaceLines,
  type DecodedText,
} from "./text-match.js";
import { findPattern } from "./pattern-match.js";
import {
  largestChangedFile,
  largestChangedShown,
  placementRefused,
  tooLargeToChange,
  writeFileAtomically,
} from "./write-file.js";
import {
  noteOwnEdit,
  requireSeenFile,
  type ReadStateContext,
} from "../file-read-state.js";
import type { ToolDefinition } from "../../tool-definition.js";
import type { ConversationItems } from "../../shared/conversation-items.js";

const maximumFiles = 20;
const maximumReplacements = 50;
const maximumQuoted = 60;
const maximumNamedTargets = 3;
/** Refuses bytes that are not UTF-8, and keeps a byte-order mark as read. */
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const pathSchema = {
  type: "string",
  description:
    "Workspace-relative path of an existing file, or an absolute path for one outside the workspace.",
};

const replacementsSchema = {
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
          "Exact text to replace, including enough surrounding text to occur only once; or, with regex, the pattern to match.",
      },
      replace: {
        type: "string",
        description:
          "Exact text to put in its place; with regex, $1 or $<name> stand for what a group matched and $& for the whole match.",
      },
      replaceAll: {
        type: "boolean",
        description:
          "Replace every occurrence instead of requiring exactly one; an occurrence that overlaps one already replaced is left as it is.",
      },
      regex: {
        type: "boolean",
        description:
          "find is a JavaScript regular expression: ^ and $ match at each line, . does not match a line ending, and letter case counts. Use it to change many similar places in one replacement.",
      },
    },
    required: ["find", "replace"],
    additionalProperties: false,
  },
};

const multiEditSpec: ToolSpec = {
  name: "multi_edit",
  checksWork: "shows",
  description: `Replace text in files that already exist: in the current workspace by a workspace-relative path, or elsewhere by an absolute path, which the person is asked about by that path. Give one file by path and replacements, or several as edits. The file must have been read in this conversation since it last changed. The answer shows the lines each edit wrote, numbered, with one line around each. Each replacement finds exact text, or what a pattern matches when regex is set, and must match exactly one place unless replaceAll is set. Line endings, a byte-order mark, trailing whitespace, and the indentation of a whole block are matched flexibly; the words themselves must match. That flexible matching works in files of at most ${maximumSearchLines.toLocaleString("en-US")} lines, for text to find of at most ${maximumPatternLines.toLocaleString("en-US")} lines. A file larger than ${largestChangedShown} is not changed. Either every replacement applies or none does.`,
  inputSchema: {
    type: "object",
    properties: {
      path: pathSchema,
      replacements: replacementsSchema,
      edits: {
        type: "array",
        minItems: 1,
        maxItems: maximumFiles,
        description:
          "For several files, instead of path and replacements: one entry per file, each file at most once.",
        items: {
          type: "object",
          properties: { path: pathSchema, replacements: replacementsSchema },
          required: ["path", "replacements"],
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
};

type Replacement = {
  readonly find: string;
  readonly replace: string;
  readonly replaceAll: boolean;
  readonly regex: boolean;
};

type FileEdit = {
  readonly path: string;
  readonly replacements: readonly Replacement[];
};

type EditArguments = { readonly edits: readonly FileEdit[] };

type ResolvedFile = {
  /** Where it really is, from the workspace folder, or whole when outside it. */
  readonly path: string;
  /** Outside the workspace, which the person approved by its path. */
  readonly outside: boolean;
  /** As the call named it. */
  readonly named: string;
  readonly absolute: string;
  /** The same for every name of one file, hard links included. */
  readonly identity: string;
  readonly decoded: DecodedText;
  readonly text: string;
  readonly replacements: number;
  readonly loose: readonly number[];
};

type PlannedEdit = {
  readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
  readonly files: readonly ResolvedFile[];
};

type Refusal = Extract<ToolCallInspection, { readonly ok: false }>;

/** A refusal the model can fix by aiming the edit differently. */
function correctable(reason: string): Refusal {
  return { ok: false, reason, correctable: true };
}

type ReplacementInput = {
  readonly find: string;
  readonly replace: string;
  readonly replaceAll?: boolean;
  readonly regex?: boolean;
};

type FileEditInput = {
  readonly path?: string;
  readonly replacements?: readonly ReplacementInput[];
};

/** One file's path and replacements, wherever in the call they sit. */
function fileEdit({ path, replacements }: FileEditInput): FileEdit | undefined {
  if (!path?.trim() || !replacements?.every(({ find }) => find)) return;
  return {
    path: normalizePath(path),
    replacements: replacements.map((replacement) => ({
      regex: replacement.regex ?? false,
      // A model's text arrives with whatever endings it chose; the file's own
      // conventions are restored when it is written back.
      find: normalizeEndings(replacement.find),
      replace: normalizeEndings(replacement.replace),
      replaceAll: replacement.replaceAll ?? false,
    })),
  };
}

/** The files a call edits: one at its top, or several as edits, never both. */
function editArguments(
  args: unknown,
): EditArguments | { readonly mixed: true } | undefined {
  const input = schemaInput<
    FileEditInput & { readonly edits?: readonly FileEditInput[] }
  >(multiEditSpec.inputSchema, args);
  if (!input) return;
  const { edits: list, ...top } = input;
  if (Object.keys(top).length) {
    if (list !== undefined) return { mixed: true };
    const edit = fileEdit(top);
    return edit ? { edits: [edit] } : undefined;
  }
  if (!list) return;
  const edits: FileEdit[] = [];
  for (const entry of list) {
    const edit = fileEdit(entry);
    if (!edit) return;
    edits.push(edit);
  }
  return { edits };
}

function quoted(value: string): string {
  return `“${shortened(value, maximumQuoted).replaceAll("\n", "⏎")}”`;
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

/**
 * Applies one file's replacements in order, each to the text the previous one
 * produced. Nothing here touches the disk: the caller decides whether the whole
 * edit is worth proposing before any of it is written.
 */
function applyReplacements(
  edit: FileEdit,
  original: string,
):
  | {
      readonly text: string;
      /** The replacements, from 1, found only with indentation set aside. */
      readonly loose: readonly number[];
    }
  | { readonly refusal: Refusal } {
  let lines = original.split("\n");
  const loose: number[] = [];
  const refused = (refusal: Refusal) => ({ refusal });
  for (const [index, given] of edit.replacements.entries()) {
    let replacement = given;
    if (!replacement.regex && replacement.find === replacement.replace) {
      return refused(
        correctable(
          `A replacement in ${edit.path} puts back the same text. No file was changed.`,
        ),
      );
    }

    const text = lines.join("\n");
    // Each place an exact or pattern match rewrites, and what it puts there.
    let spots:
      readonly { start: number; length: number; text: string }[] | undefined;
    let match: ReturnType<typeof findText>;
    if (replacement.regex) {
      const found = findPattern(text, replacement.find, replacement.replace);
      if (found.kind === "refused")
        return refused(
          correctable(`${edit.path}: ${found.reason} No file was changed.`),
        );
      if (found.kind === "none")
        return refused(
          correctable(
            `The pattern ${quoted(replacement.find)} matched nothing in ${edit.path}. Read the file again and retry with a pattern for its current text. No file was changed.`,
          ),
        );
      spots = found.targets;
      match = { kind: "exact", offsets: spots.map((spot) => spot.start) };
    } else match = findText(text, replacement.find);
    const unnumbered = replacement.regex
      ? undefined
      : withoutLineNumbers(replacement);
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
        ),
      );
    }

    if (match.kind === "flexible") loose.push(index + 1);
    const occurrences =
      match.kind === "exact" ? match.offsets.length : match.lines.length;
    if (match.kind === "exact")
      spots ??= match.offsets.map((start) => ({
        start,
        length: replacement.find.length,
        text: replacement.replace,
      }));
    // A pattern's matches never overlap; exact text can overlap itself.
    const chosen = new Set(
      replacement.replaceAll
        ? replacement.regex
          ? (spots ?? []).map((spot) => spot.start)
          : separateOccurrences(match, replacement.find)
        : match.kind === "exact"
          ? match.offsets.slice(0, 1)
          : match.lines.slice(0, 1),
    );
    const targets =
      match.kind === "exact"
        ? (spots ?? []).filter((spot) => chosen.has(spot.start))
        : [...chosen].map((start) => ({
            start,
            length: 0,
            text: replacement.replace,
          }));
    // Where each line starts in the text as it now is.
    const lineStarts = [0];
    for (const line of lines)
      lineStarts.push((lineStarts.at(-1) ?? 0) + line.length + 1);
    // Each target as the lines it rewrites in the text as it now is.
    const touched = targets.map((target) => {
      const { start, length } = target;
      if (match.kind === "flexible")
        return { ...target, first: start, last: start + match.lineCount - 1 };
      const first = lineHolding(lineStarts, start);
      const matched = text.slice(start, start + length);
      return {
        ...target,
        first,
        last: first + matched.split("\n").length - 1,
      };
    });
    if (occurrences > 1 && !replacement.replaceAll)
      return refused(
        correctable(
          replacement.regex
            ? `The pattern ${quoted(replacement.find)} matches ${occurrences} places in ${edit.path}. Make it match only the one meant, or set replaceAll. No file was changed.`
            : `${quoted(replacement.find)} appears ${occurrences} times in ${edit.path}. Include surrounding text to make it unique, or set replaceAll. No file was changed.`,
        ),
      );

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
    const keep = (from: number, to: number) => {
      for (let line = from; line < to; line += 1)
        nextLines.push(lines[line] ?? "");
    };
    let kept = 0;
    for (const group of groups) {
      const first = group[0]?.first ?? 0;
      let last = first;
      for (const target of group) last = Math.max(last, target.last);
      keep(kept, first);
      let segment = lines.slice(first, last + 1).join("\n");
      if (match.kind === "exact") {
        const base = lineStarts[first] ?? 0;
        const pieces: string[] = [];
        let from = 0;
        for (const target of group) {
          const at = target.start - base;
          pieces.push(segment.slice(from, at), target.text);
          from = at + target.length;
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
      nextLines.push(...segment.split("\n"));
      kept = last + 1;
    }
    keep(kept, lines.length);
    lines = nextLines;
  }

  const text = lines.join("\n");
  if (text === original) {
    return refused(
      correctable(
        `The replacements for ${edit.path} would change nothing. No file was changed.`,
      ),
    );
  }
  return { text, loose };
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
      withSchemaProblems(
        "Describe each file to edit and the exact text to replace in it: one file as path and replacements, or several as edits. Every file needs at least one replacement.",
        args,
        multiEditSpec.inputSchema,
      ),
    );
  }
  if ("mixed" in input)
    return correctable(
      "Give one file as path and replacements, or several as edits, not both. No file was changed.",
    );

  const seen = new Set<string>();
  for (const edit of input.edits) {
    if (seen.has(edit.path)) {
      return correctable(
        `${edit.path} is listed twice. Put every replacement for one file in a single entry.`,
      );
    }
    seen.add(edit.path);
    // An absolute path names a file outside the workspace, which the person
    // is asked about by that path; a relative one is the workspace's.
    if (
      !isAbsolute(edit.path) &&
      (namesStream(edit.path) || !staysInside(root, resolve(root, edit.path)))
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

  for (const edit of input.edits) {
    if (signal?.aborted)
      return {
        ok: false,
        reason: "The edit was not prepared; the task stopped.",
      };
    let absolute: string;
    let outside = false;
    if (isAbsolute(edit.path)) {
      const place = await placeOutside(realRoot, edit.path, {
        protect: context.protect ?? [],
      });
      if (place.kind !== "writable")
        return placementRefused(edit.path, place.kind);
      if (!place.exists)
        return correctable(
          `${edit.path} was not found. multi_edit only changes files that already exist.`,
        );
      absolute = place.absolute;
      outside = !place.inside;
    } else
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
    if (!outside && !realStaysInside(realRoot, absolute)) {
      return {
        ok: false,
        reason: "Every edited file must stay inside the current workspace.",
      };
    }
    // Named by where it really is, so two spellings of one file are one file;
    // one outside the workspace by its whole real path.
    const path = outside
      ? absolute
      : toForwardSlashes(relative(realRoot, absolute));
    let identity: string;
    try {
      const entry = await stat(absolute, { bigint: true });
      if (!entry.isFile()) {
        return correctable(
          `${edit.path} is a folder in this workspace, not a file.`,
        );
      }
      // Checked before anything of the file is loaded.
      if (entry.size > BigInt(largestChangedFile))
        return correctable(tooLargeToChange(edit.path));
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
    const unseen = await requireSeenFile(absolute, path, context, {
      whole: false,
    });
    if (unseen) return unseen;
    const applied = applyReplacements(edit, decoded.text);
    if ("refusal" in applied) return applied.refusal;
    const { loose } = applied;
    files.push({
      path,
      outside,
      named: edit.path,
      absolute,
      identity,
      decoded,
      text: applied.text,
      replacements: edit.replacements.length,
      loose,
    });
  }

  const replacements = input.edits.reduce(
    (total, edit) => total + edit.replacements.length,
    0,
  );
  const outside = files.some((planned) => planned.outside);
  return {
    files,
    inspection: {
      ok: true,
      action: outside
        ? input.edits.length === 1
          ? "Edit a file outside the workspace"
          : "Edit files, some outside the workspace"
        : input.edits.length === 1
          ? "Edit a workspace file"
          : "Edit workspace files",
      target: describeTargets(files.map((planned) => planned.path)),
      // A grant for the file or its folder covers the change (ADR 0012).
      ...(outside ? { grantableByFile: true as const } : {}),
      effects: changingFiles(files),
      changes: files.map((file) =>
        describeChange(file.path, "updated", file.text, file.decoded.text),
      ),
      detail: `${outside ? "A file is outside the folder you selected. " : ""}This applies ${count("replacement", replacements)} to ${count(
        "existing file",
        input.edits.length,
      )}. Nothing else is changed.`,
      command: describeCommand(multiEditSpec.name, input),
    },
  };
}

async function inspectMultiEdit(
  root: string,
  args: unknown,
  context: ReadStateContext = {},
): Promise<ToolCallInspection> {
  const planned = await planMultiEdit(root, args, undefined, context);
  return "inspection" in planned ? planned.inspection : planned;
}

async function runMultiEdit(
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
      const unseen = await requireSeenFile(file.absolute, file.path, context, {
        whole: false,
      });
      if (unseen)
        return {
          ok: false,
          reason: `${unseen.reason} ${produced.length ? `Earlier files changed: ${produced.map((item) => item.path).join(", ")}.` : "No file was changed."}`,
          ...written(),
        };
      await writeFileAtomically(file.absolute, encoded, signal);
      await noteOwnEdit(file.absolute, encoded, context);
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
      files: planned.files.map((file) => editedFile(file)),
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

/**
 * What one file is now, as the model is shown it: the lines the edit wrote
 * with one around each, and a replacement that was found only loosely.
 */
function editedFile(file: ResolvedFile) {
  const { lines, notShown, finalBreak } = editedLines(
    file.decoded.text,
    file.text,
  );
  const notes = [
    file.loose.length
      ? `${file.loose.length === 1 ? "Replacement" : "Replacements"} ${spokenNumbers(file.loose)} ${file.loose.length === 1 ? "was" : "were"} found only with indentation and trailing spaces set aside, and ${file.loose.length === 1 ? "was" : "were"} written at the file's indentation.`
      : undefined,
    finalBreak === "added"
      ? "A line break was added at the end of the file."
      : finalBreak === "removed"
        ? "The line break at the end of the file was removed."
        : undefined,
    notShown
      ? `${notShown} more changed line${notShown === 1 ? " is" : "s are"} not shown; read_file shows them.`
      : undefined,
  ].filter((note) => note !== undefined);
  return {
    path: file.path,
    replacements: file.replacements,
    lines,
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}

function spokenNumbers(numbers: readonly number[]): string {
  return numbers.length < 2
    ? String(numbers[0])
    : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
}

/** Editing files in place, as the registry offers it. */
export function multiEditTool(
  items: ConversationItems | undefined,
  protect: readonly string[],
): ToolDefinition {
  return {
    spec: multiEditSpec,
    requiresWorkspace: true,
    inspect: (args, conversationId, { root }) =>
      inspectMultiEdit(root, args, { items, conversationId, protect }),
    execute: (args, signal, conversationId, { root }) =>
      runMultiEdit(root, args, signal, { items, conversationId, protect }),
  };
}
