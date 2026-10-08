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

import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts } from "./action-detail.js";
import {
  byPath,
  printedPath,
  ripgrep,
  selection,
  skippedFolders,
  type RipgrepContext,
} from "./ripgrep.js";
import {
  errorCode,
  isAbortError,
  normalizePath,
  scopeOf,
} from "./workspace-path.js";

/** Matching lines shown; the count goes on past this. */
const maximumResults = 100;
const maximumLineLength = 300;
const maximumQueryLength = 400;

export const searchFilesSpec: ToolSpec = {
  access: "read",
  name: "search_files",
  description:
    "Find which text files in the current workspace contain a piece of text, and on which lines. The text is found as written, ignoring letter case, unless regex or caseSensitive says otherwise. Files the folder's .gitignore lists, hidden files, and generated folders such as .git and node_modules are not searched unless includeIgnored is true; generated folders never are. The answer says how many lines matched in all. Word, Excel and PDF files are not searched inside: read a PDF with read_document.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The text, or pattern, to find." },
      path: {
        type: "string",
        description:
          "Workspace-relative folder to search in. Defaults to the whole workspace.",
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
          "Only search files whose names match this pattern, such as '*.md' or '*.{ts,tsx}'.",
      },
      includeIgnored: {
        type: "boolean",
        description:
          "Also search files .gitignore lists, and hidden files. Defaults to false.",
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
};

const argumentNames = [
  "query",
  "path",
  "regex",
  "caseSensitive",
  "files",
  "includeIgnored",
];

function searchArguments(args: unknown): SearchArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const source = args as Record<string, unknown>;
  if (Object.keys(source).some((key) => !argumentNames.includes(key))) return;
  const query = source["query"];
  if (typeof query !== "string" || !query.trim()) return;
  if (query.length > maximumQueryLength) return;
  const path = source["path"] ?? ".";
  if (typeof path !== "string" || !path.trim()) return;
  const flags = ["regex", "caseSensitive", "includeIgnored"].map(
    (name) => source[name] ?? false,
  );
  if (flags.some((flag) => typeof flag !== "boolean")) return;
  const files = source["files"];
  if (files !== undefined && (typeof files !== "string" || !files.trim()))
    return;
  return {
    query,
    path: normalizePath(path),
    regex: flags[0] as boolean,
    caseSensitive: flags[1] as boolean,
    ...(files === undefined ? {} : { files: files.trim() }),
    includeIgnored: flags[2] as boolean,
  };
}

export function inspectSearchFiles(
  root: string,
  args: unknown,
): ToolCallInspection {
  const input = searchArguments(args);
  if (!input) {
    return {
      ok: false,
      reason: "Choose the text to look for and a folder inside the workspace.",
      correctable: true,
    };
  }
  if (scopeOf(root, resolve(root, input.path)) !== "workspace") {
    return {
      ok: false,
      reason: "The search must stay inside the current workspace.",
    };
  }
  return {
    ok: true,
    action: "Search workspace files",
    target:
      input.path === "."
        ? `“${input.query}”`
        : `“${input.query}” in ${input.path}`,
    access: "read",
    scope: "workspace",
    command: `search_files(${JSON.stringify(input)})`,
  };
}

type Match = {
  readonly path: string;
  readonly line: number;
  readonly text: string;
};

/** One line of ripgrep's JSON answer, as far as the search reads it. */
type Message = {
  readonly type: string;
  readonly data?: {
    readonly path?: { readonly text?: string };
    readonly lines?: { readonly text?: string };
    readonly line_number?: number;
    readonly stats?: { readonly matched_lines?: number };
  };
};

/**
 * Keeps only the matches shown, first by path. ripgrep is not asked to sort:
 * sorting makes it search one file at a time, four times slower on 20,000
 * files, and only the shown few need an order.
 */
const keptBeforeTrimming = 10 * maximumResults;
function firstShown(matches: Match[]): void {
  matches.sort(
    (left, right) => byPath(left.path, right.path) || left.line - right.line,
  );
  matches.length = Math.min(matches.length, maximumResults);
}

export type SearchContext = RipgrepContext;

export async function runSearchFiles(
  root: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: SearchContext,
): Promise<ToolInvocationResult> {
  const inspected = inspectSearchFiles(root, args);
  if (!inspected.ok) return inspected;
  const input = searchArguments(args);
  if (!input) return { ok: false, reason: "The search input is invalid." };

  try {
    const realRoot = await realpath(root);
    const base = await realpath(resolve(realRoot, input.path));
    if (scopeOf(realRoot, base) !== "workspace") {
      return {
        ok: false,
        reason: "The search must stay inside the current workspace.",
      };
    }
    const matches: Match[] = [];
    let seen = 0;
    let total: number | undefined;
    const run = await ripgrep({
      ...context,
      cwd: realRoot,
      signal,
      args: [
        "--json",
        "--path-separator",
        "/",
        input.caseSensitive ? "--case-sensitive" : "--ignore-case",
        ...(input.regex ? [] : ["--fixed-strings"]),
        ...selection(input.includeIgnored),
        ...(input.files ? ["--iglob", input.files] : []),
        "--regexp",
        input.query,
        "--",
        input.path,
      ],
      line: (text) => {
        const message = JSON.parse(text) as Message;
        if (message.type === "summary")
          total = message.data?.stats?.matched_lines;
        if (message.type !== "match") return;
        seen += 1;
        const line = (message.data?.lines?.text ?? "").replace(/\r?\n$/, "");
        matches.push({
          path: printedPath(message.data?.path?.text ?? ""),
          line: message.data?.line_number ?? 0,
          text:
            line.length > maximumLineLength
              ? `${line.slice(0, maximumLineLength)}…`
              : line,
        });
        if (matches.length >= keptBeforeTrimming) firstShown(matches);
      },
    });
    firstShown(matches);
    if (run.cancelled)
      return { ok: false, reason: "The search was cancelled." };
    // ripgrep answers 2 for an error, even beside matches it found. A pattern
    // it could not read is named, so the model can write one it can.
    if (run.exitCode === 2 && !seen) {
      const bad = /regex parse error/i.test(run.errors)
        ? input.query
        : /error parsing glob/i.test(run.errors)
          ? input.files
          : undefined;
      return {
        ok: false,
        reason:
          bad === undefined
            ? "The workspace could not be searched."
            : `“${bad}” is not a valid pattern.`,
      };
    }
    const complete = run.complete && total !== undefined;
    const counted = complete ? (total ?? seen) : seen;
    const truncated = matches.length < counted || !complete;
    const notSearched = [
      ...skippedFolders,
      ...(input.includeIgnored
        ? []
        : ["files .gitignore lists", "hidden files"]),
    ];
    return {
      ok: true,
      value: {
        query: input.query,
        matches,
        ...(complete ? { total: counted } : { atLeast: counted }),
        truncated,
        notSearched,
      },
      ...detailsOf(
        facts(
          ["Looking for", input.query],
          ["Matching lines", complete ? counted : `at least ${counted}`],
        ),
        {
          kind: "matches",
          items: matches,
          ...(truncated ? { truncated: true } : {}),
          note: `Not searched: ${notSearched.join(", ")}.`,
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
