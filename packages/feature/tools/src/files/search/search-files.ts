/**
 * Finds which workspace files contain a piece of text.
 *
 * This exists so that looking around does not have to go through the shell. A
 * shell command can do anything the account can do, so it is asked about every
 * time; a search that cannot leave the workspace and cannot write anything is
 * ordinary work, and interrupting a person for it teaches them to approve
 * without reading. Making the safe route available is what makes stopping for
 * the unsafe one worth something.
 *
 * Text is literal unless a pattern is asked for: a model looking for text it
 * read somewhere should find that text, brackets and all. The search runs on
 * the bundled ripgrep, so a whole folder is searched and the count is real.
 */

import { open, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts } from "../../shared/action-detail.js";
import { effectsOf } from "../../shared/effects.js";
import { schemaInput, withSchemaProblems } from "@zhiyin/tool-input";
import { shortened } from "@zhiyin/text-and-names";
import { anyDownloaded } from "../../shared/mark-of-the-web.js";
import {
  byPath,
  printedPath,
  ripgrep,
  notSearchedIn,
  searchingFolder,
  type RipgrepContext,
} from "@zhiyin/workspace-listing";
import {
  errorCode,
  isAbortError,
  normalizePath,
  realLocation,
  scopeOf,
  toForwardSlashes,
} from "../../shared/workspace-path.js";
import { lineText } from "../reading/text-pages.js";
import {
  FoundLines,
  maximumContext,
  maximumLines,
  maximumMatches,
} from "./found-lines.js";
import type { ToolDefinition } from "../../tool-definition.js";

const maximumLineLength = 300;
/** Files named when only the files are asked for. */
const maximumFiles = 200;
const maximumQueryLength = 400;

const searchFilesSpec: ToolSpec = {
  access: "read",
  name: "search_files",
  description: `Find which text files in the current workspace contain a piece of text, and on which lines. The text is found as written, ignoring letter case, unless regex or caseSensitive says otherwise. Files the workspace's .gitignore lists and hidden files are not searched unless includeIgnored is true. Nor are folders that usually hold generated files, such as node_modules, build and dist, unless includeIgnored is true or the folder searched is one of them; .git is searched only when it is the folder searched. At most ${maximumMatches} matching lines are shown, each cut to ${maximumLineLength} characters, and the answer says how many lines matched in all. They are grouped by file, with how many of each file's lines matched. output "files" names each file that matched, at most ${maximumFiles}, with how many of its lines matched; output "count" gives only the totals. context shows up to ${maximumContext} lines around each match, at most ${maximumLines} lines in all. Binary files, Word, Excel and PDF files among them, are not searched inside: read a PDF with read_document. To find files by name or type, use find_files. Prefer these two to grep, find, dir or findstr in a shell: they need no approval and their answers are bounded.`,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        maxLength: maximumQueryLength,
        description: "The text, or pattern, to find.",
      },
      path: {
        type: "string",
        description:
          "Workspace-relative folder, or one file, to search in. A file named here is searched whatever .gitignore lists. Defaults to the whole workspace.",
      },
      regex: {
        type: "boolean",
        description:
          "Read query as a regular expression rather than as text. Defaults to false.",
      },
      caseSensitive: {
        type: "boolean",
        description: "Match letter case exactly. Defaults to false.",
      },
      files: {
        type: "string",
        description:
          "Only search files whose names match this pattern, in either letter case, as find_files matches a name: '*' and '?' within it, '[0-9]' one character of a set, '{ts,tsx}' either alternative, such as '*.md' or 'report[0-9].*'. It holds no folder: give the folder as path.",
      },
      includeIgnored: {
        type: "boolean",
        description:
          "Also search files .gitignore lists, hidden files, and folders of generated files. Defaults to false.",
      },
      output: {
        type: "string",
        enum: ["lines", "files", "count"],
        description:
          'What to show: "lines", the matching lines (the default); "files", each file that matched and how many of its lines did; "count", only the totals.',
      },
      context: {
        type: "integer",
        minimum: 0,
        maximum: maximumContext,
        description:
          'Lines to show before and after each match, with output "lines". Defaults to 0.',
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

type SearchArguments = {
  readonly query: string;
  readonly path: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  readonly files?: string;
  readonly includeIgnored: boolean;
  readonly output: Output;
  readonly context: number;
};

type Output = "lines" | "files" | "count";

function searchArguments(args: unknown): SearchArguments | string | undefined {
  const query = (args as { readonly query?: unknown } | undefined)?.query;
  if (typeof query === "string" && query.length > maximumQueryLength)
    return `The query is ${query.length} characters; it can be at most ${maximumQueryLength}. Search for a shorter, distinctive part of the text.`;
  const input = schemaInput<{
    readonly query: string;
    readonly path?: string;
    readonly regex?: boolean;
    readonly caseSensitive?: boolean;
    readonly files?: string;
    readonly includeIgnored?: boolean;
    readonly output?: Output;
    readonly context?: number;
  }>(searchFilesSpec.inputSchema, args);
  if (
    !input?.query.trim() ||
    input.path?.trim() === "" ||
    input.files?.trim() === ""
  )
    return;
  const output = input.output ?? "lines";
  const context = input.context ?? 0;
  if (output !== "lines" && context > 0)
    return 'context shows lines around each match, so it goes with output "lines" only.';
  return {
    query: input.query,
    path: normalizePath(input.path ?? "."),
    regex: input.regex ?? false,
    caseSensitive: input.caseSensitive ?? false,
    ...(input.files === undefined
      ? {}
      : { files: input.files.trim().replace(/^(\*\*\/)+/, "") }),
    includeIgnored: input.includeIgnored ?? false,
    output,
    context,
  };
}

function inspectSearchFiles(root: string, args: unknown): ToolCallInspection {
  const input = searchArguments(args);
  if (typeof input !== "object") {
    return {
      ok: false,
      reason:
        input ??
        withSchemaProblems(
          "Choose the text to look for and a folder inside the workspace.",
          args,
          searchFilesSpec.inputSchema,
        ),
      correctable: true,
    };
  }
  if (scopeOf(root, resolve(root, input.path)) !== "workspace") {
    return {
      ok: false,
      reason: "The search must stay inside the current workspace.",
    };
  }
  // A backslash is a Windows folder, unless it escapes glob punctuation a
  // file name can hold: no name on Windows holds "*" or "?" to escape.
  if (input.files?.includes("/") || /\\[^[\]{},!]/.test(input.files ?? ""))
    return {
      ok: false,
      reason: `files matches file names only, such as '*.md'. To search one folder, give it as path.`,
      correctable: true,
    };
  // ripgrep reads a colon as the end of a type's name; no file name holds one.
  if (input.files?.includes(":"))
    return {
      ok: false,
      reason: `“${input.files}” is not a valid pattern.`,
      correctable: true,
    };
  return {
    ok: true,
    action: "Search workspace files",
    target:
      input.path === "."
        ? `“${input.query}”`
        : `“${input.query}” in ${input.path}`,
    command: `search_files(${JSON.stringify(input)})`,
    effects: effectsOf({ reads: "workspace" }),
  };
}

/**
 * Whether a file reads as binary, as ripgrep takes one: a NUL byte in what it
 * reads first. A folder's search skips such files; one named is refused alike.
 */
async function isBinary(path: string): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const start = Buffer.alloc(binaryLook);
    const { bytesRead } = await file.read(start, 0, binaryLook, 0);
    return start.subarray(0, bytesRead).includes(0);
  } finally {
    await file.close();
  }
}

/** How much of a file is looked at for a NUL byte, as ripgrep's first read. */
const binaryLook = 64 * 1024;

function binaryFile(path: string) {
  return {
    ok: false,
    correctable: true,
    reason: `${path} is a binary file, which search_files does not search as text. Read a PDF with read_document; for a file of another kind, find a tool that reads it.`,
  } as const;
}

/** A file pattern chooses among a folder's files; one file leaves it nothing to choose. */
function patternOnAFile(path: string) {
  return {
    ok: false,
    correctable: true,
    reason: `${path} is one file, so files has nothing to choose from. Leave files out, or give a folder as path.`,
  } as const;
}

/** The search's inspection, which names a file pattern given with one file before anyone is asked. */
async function inspectSearchFilesIn(
  root: string,
  args: unknown,
): Promise<ToolCallInspection> {
  const inspected = inspectSearchFiles(root, args);
  const input = searchArguments(args);
  if (!inspected.ok || typeof input !== "object" || !input.files)
    return inspected;
  const found = await stat(resolve(root, input.path)).catch(() => undefined);
  return found?.isFile() ? patternOnAFile(input.path) : inspected;
}

/** One line of ripgrep's JSON answer, as far as the search reads it. */
type Message = {
  readonly type: string;
  readonly data?: {
    readonly path?: { readonly text?: string };
    readonly lines?: { readonly text?: string; readonly bytes?: string };
    readonly line_number?: number;
    readonly stats?: { readonly matched_lines?: number };
  };
};

/**
 * A matching line's text. ripgrep sends a line that is not UTF-8 as its bytes,
 * which are read as read_file reads them.
 */
function shownLine(message: Message): string {
  const lines = message.data?.lines;
  if (lines?.text !== undefined) return lines.text;
  return lines?.bytes ? lineText(Buffer.from(lines.bytes, "base64")) : "";
}

/**
 * Chooses files by name below the workspace's ignore files: a ripgrep type,
 * which ranks below them, where a glob would override them and bring in what
 * they list. A type matches case exactly, so each letter matches either case,
 * as file names on Windows do.
 */
function byName(pattern: string): string[] {
  return ["--type-add", `named:${caseless(pattern)}`, "--type", "named"];
}

/** A glob whose letters match either case: `*.md` as `*.[mM][dD]`. */
function caseless(pattern: string): string {
  let out = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "\\") {
      out += pattern.slice(index, index + 2);
      index += 1;
    } else if (character === "[") {
      const close = pattern.indexOf("]", index + 2);
      if (close < 0) return out + pattern.slice(index);
      const inside = pattern.slice(index + 1, close);
      const negated = /^[!^]/.test(inside) ? inside[0]! : "";
      const members = inside.slice(negated.length);
      out += `[${negated}${members}${swapped(members)}]`;
      index = close;
    } else
      out +=
        character.toLowerCase() === character.toUpperCase()
          ? character
          : `[${character.toLowerCase()}${character.toUpperCase()}]`;
  }
  return out;
}

function swapped(text: string): string {
  return [...text]
    .map((character) =>
      character === character.toLowerCase()
        ? character.toUpperCase()
        : character.toLowerCase(),
    )
    .join("");
}

export type SearchContext = RipgrepContext;

/** What one run of ripgrep found, however it was asked to answer. */
type Searched = {
  readonly cancelled: boolean;
  /** Why the run failed, when it found nothing and could not search. */
  readonly failure?: string;
  /** False when the run was cut short, so the counts are lower bounds. */
  readonly complete: boolean;
  readonly total: number;
  readonly inFiles: number;
  readonly found: FoundLines;
  /** Each file and how many of its lines matched, for output "files" and "count". */
  readonly counts: readonly {
    readonly path: string;
    readonly matching: number;
  }[];
  readonly cut: boolean;
};

/** Why ripgrep answered 2 having found nothing: a pattern it could not read is named. */
function runFailure(errors: string, input: SearchArguments): string {
  const bad = /regex parse error/i.test(errors)
    ? input.query
    : /error parsing glob/i.test(errors)
      ? input.files
      : undefined;
  return bad === undefined
    ? "The workspace could not be searched."
    : `“${bad}” is not a valid pattern.`;
}

type Route = {
  readonly args: readonly string[];
  readonly path: string;
  readonly inside: (printed: string) => boolean;
};

/**
 * How ripgrep reaches what is searched. A folder is walked with the
 * workspace's ignore files above it applied. A file is named to ripgrep, which
 * searches a file it is given whatever an ignore file lists, and prints its
 * name with a count only when told to.
 */
function searchRoute<T>(
  place: string,
  oneFile: boolean,
  includeIgnored: boolean,
  run: (route: Route) => Promise<T>,
): Promise<T> {
  return oneFile
    ? run({ args: ["--with-filename"], path: place, inside: () => true })
    : searchingFolder(place, includeIgnored, run);
}

async function searched(
  realRoot: string,
  place: { readonly path: string; readonly oneFile: boolean },
  input: SearchArguments,
  signal: AbortSignal | undefined,
  context: SearchContext,
): Promise<Searched> {
  const found = new FoundLines(input.context);
  const counts: { path: string; matching: number }[] = [];
  let seen = 0;
  let outside = 0;
  let total: number | undefined;
  let cut = false;
  const lines = input.output === "lines";
  const run = await searchRoute(
    place.path,
    place.oneFile,
    input.includeIgnored,
    (search) =>
      ripgrep({
        ...context,
        cwd: realRoot,
        signal,
        args: [
          ...(lines ? ["--json"] : ["--count"]),
          "--path-separator",
          "/",
          input.caseSensitive ? "--case-sensitive" : "--ignore-case",
          ...(input.regex ? [] : ["--fixed-strings"]),
          ...(lines && input.context
            ? ["--context", String(input.context)]
            : []),
          ...search.args,
          ...(input.files ? byName(input.files) : []),
          "--regexp",
          input.query,
          "--",
          search.path,
        ],
        line: (text) => {
          if (!lines) {
            // "path:count"; no file name on Windows holds a colon.
            const split = text.lastIndexOf(":");
            const path = printedPath(text.slice(0, split));
            const matching = Number(text.slice(split + 1));
            if (
              split < 0 ||
              !Number.isInteger(matching) ||
              !search.inside(path)
            )
              return;
            counts.push({ path, matching });
            seen += matching;
            return;
          }
          const message = JSON.parse(text) as Message;
          if (message.type === "summary")
            total = message.data?.stats?.matched_lines;
          if (message.type !== "match" && message.type !== "context") return;
          const path = printedPath(message.data?.path?.text ?? "");
          const isMatch = message.type === "match";
          if (!search.inside(path)) {
            if (isMatch) outside += 1;
            return;
          }
          if (isMatch) seen += 1;
          const whole = shownLine(message).replace(/\r?\n$/, "");
          if (whole.length > maximumLineLength) cut = true;
          found.add(path, {
            line: message.data?.line_number ?? 0,
            text: shortened(whole, maximumLineLength),
            ...(isMatch ? {} : { context: true as const }),
          });
        },
      }),
  );
  if (total !== undefined) total -= outside;
  const complete = run.complete && (lines ? total !== undefined : true);
  counts.sort((left, right) => byPath(left.path, right.path));
  return {
    cancelled: run.cancelled,
    ...(run.exitCode === 2 && !seen
      ? { failure: runFailure(run.errors, input) }
      : {}),
    complete,
    total: complete && total !== undefined ? total : seen,
    inFiles: lines ? found.inFiles : counts.length,
    found,
    counts,
    cut,
  };
}

/** What the answer says it leaves out, and how to see it. */
function searchNotes(
  input: SearchArguments,
  run: Searched,
  shown: { readonly matches: number; readonly files: number },
): string[] {
  const narrow = "Narrow the query, the folder or files";
  const files = run.inFiles === 1 ? "file" : "files";
  const notes: (string | undefined)[] = [];
  if (input.output === "lines") {
    const allFiles =
      shown.files < run.inFiles
        ? `, in ${shown.files} of the ${run.inFiles} ${files} that matched`
        : "";
    const toFiles = allFiles
      ? ', or give output "files" to see every file that matched'
      : "";
    notes.push(
      !run.complete
        ? `The search was cut short, so only ${shown.matches} of at least ${run.total} matching lines are shown${allFiles}. ${narrow}${toFiles}.`
        : shown.matches < run.total
          ? `Showing the first ${shown.matches} of ${run.total} matching lines${allFiles}. ${narrow} to see the rest${toFiles}.`
          : undefined,
      run.cut
        ? `Lines longer than ${maximumLineLength} characters are cut at ${maximumLineLength}, marked with …; read_file shows the whole line.`
        : undefined,
    );
  } else if (input.output === "files")
    notes.push(
      !run.complete
        ? `The search was cut short, so only ${shown.files} of at least ${run.inFiles} ${files} that matched are named. ${narrow}.`
        : shown.files < run.inFiles
          ? `Showing the first ${shown.files} of the ${run.inFiles} files that matched. ${narrow} to see the rest.`
          : undefined,
    );
  else if (!run.complete)
    notes.push(
      `The search was cut short, so the counts are lower bounds. ${narrow}.`,
    );
  return notes.filter((note) => note !== undefined);
}

export async function runSearchFiles(
  root: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: SearchContext,
): Promise<ToolInvocationResult> {
  const inspected = inspectSearchFiles(root, args);
  if (!inspected.ok) return inspected;
  const input = searchArguments(args);
  if (typeof input !== "object")
    return { ok: false, reason: "The search input is invalid." };

  try {
    const real = await realLocation(root, input.path);
    const realRoot = real.root;
    if (real.scope !== "workspace") {
      return {
        ok: false,
        reason: "The search must stay inside the current workspace.",
      };
    }
    const folder = toForwardSlashes(relative(realRoot, real.path));
    const oneFile = (await stat(real.path)).isFile();
    if (oneFile && input.files) return patternOnAFile(input.path);
    if (oneFile && (await isBinary(real.path))) return binaryFile(input.path);
    const run = await searched(
      realRoot,
      { path: folder, oneFile },
      input,
      signal,
      context,
    );
    if (run.cancelled)
      return { ok: false, reason: "The search was cancelled." };
    if (run.failure) return { ok: false, reason: run.failure };
    const lines = input.output === "lines" ? run.found.shown() : undefined;
    const named =
      input.output === "files" ? run.counts.slice(0, maximumFiles) : undefined;
    const shownMatches = lines?.matches ?? 0;
    const shownFiles = lines?.files.length ?? named?.length ?? 0;
    const truncated =
      !run.complete ||
      (input.output === "lines" && shownMatches < run.total) ||
      (input.output === "files" && shownFiles < run.inFiles);
    const notSearched = oneFile
      ? []
      : [...notSearchedIn(folder, input.includeIgnored), "binary files"];
    const notes = searchNotes(input, run, {
      matches: shownMatches,
      files: shownFiles,
    });
    // Only what the model is shown can steer it.
    const downloaded = lines
      ? await anyDownloaded(
          lines.files.map((file) => join(realRoot, file.path)),
        )
      : false;
    const matchItems = (lines?.files ?? []).flatMap((file) =>
      file.lines
        .filter((line) => !line.context)
        .map(({ line, text }) => ({ path: file.path, line, text })),
    );
    return {
      ok: true,
      ...(downloaded ? { brings: "outside" as const } : {}),
      value: {
        query: input.query,
        ...(lines ? { files: lines.files } : {}),
        ...(named ? { files: named } : {}),
        ...(run.complete ? { total: run.total } : { atLeast: run.total }),
        inFiles: run.inFiles,
        truncated,
        ...(notes.length ? { note: notes.join(" ") } : {}),
        notSearched,
      },
      ...detailsOf(
        facts(
          ["Looking for", input.query],
          [
            "Matching lines",
            run.complete ? run.total : `at least ${run.total}`,
          ],
          ["Files", run.inFiles],
        ),
        lines
          ? {
              kind: "matches",
              items: matchItems,
              ...(truncated ? { truncated: true } : {}),
              ...(notSearched.length
                ? { note: `Not searched: ${notSearched.join(", ")}.` }
                : {}),
            }
          : {
              kind: "list",
              label: `${run.inFiles} files matched`,
              items: (named ?? []).map(
                (file) => `${file.path} (${file.matching})`,
              ),
              ...(truncated ? { truncated: true } : {}),
            },
      ),
    };
  } catch (error) {
    if (isAbortError(error))
      return { ok: false, reason: "The search was cancelled." };
    if (errorCode(error) === "ENOENT")
      return {
        ok: false,
        reason: `${input.path} was not found in this workspace.`,
      };
    return { ok: false, reason: "The workspace could not be searched." };
  }
}

/** The content search, as the registry offers it where ripgrep is. */
export function searchFilesTool(search: SearchContext): ToolDefinition {
  return {
    spec: searchFilesSpec,
    requiresWorkspace: true,
    inspect: (args, _id, { root }) => inspectSearchFilesIn(root, args),
    execute: (args, signal, _id, { root }) =>
      runSearchFiles(root, args, signal, search),
  };
}
