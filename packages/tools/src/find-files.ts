/**
 * Finds workspace files and folders by name.
 *
 * Content search answers "which file says this"; people as often know what a
 * file is called, or what kind it is: "every PDF under Invoices". Listing
 * folder by folder to answer that spends a request per level and still misses
 * what is deeper. The bundled ripgrep lists the folder's files, following its
 * ignore files, and folders are found from the files they hold; a folder with
 * no file in it is not found.
 *
 * Patterns are the familiar file-name kind, not a regular expression: `*` and
 * `?` within a name, `**` across folders, `{a,b}` for alternatives. Matching
 * ignores letter case, as Windows does.
 */

import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf } from "./action-detail.js";
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
  toForwardSlashes,
} from "./workspace-path.js";

/** Matches shown; the count goes on past this. */
const maximumMatches = 200;
const maximumPatternLength = 400;

export const findFilesSpec: ToolSpec = {
  access: "read",
  name: "find_files",
  description:
    "Find files and folders in the current workspace by name. A pattern without a slash matches names at any depth, such as '*.pdf' or 'budget*'; a pattern with a slash matches the path from the folder searched, such as 'Invoices/**/*.pdf'. '*' and '?' match within a name, '**' across folders, '{docx,xlsx}' either alternative. Letter case is ignored. Files the folder's .gitignore lists, hidden files, and generated folders such as .git and node_modules are not searched unless includeIgnored is true; generated folders never are. The answer says how many matched in all.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The name or path pattern to look for.",
      },
      path: {
        type: "string",
        description:
          "Workspace-relative folder to search in. Defaults to the whole workspace.",
      },
      includeIgnored: {
        type: "boolean",
        description:
          "Also find files .gitignore lists, and hidden files. Defaults to false.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
};

type FindArguments = {
  readonly pattern: string;
  readonly path: string;
  readonly includeIgnored: boolean;
  readonly matcher: Matcher;
};

type Matcher = { readonly test: (relativePath: string) => boolean };

/** The pattern as a regular expression, or a reason it cannot be one. */
function compile(pattern: string): Matcher | string {
  const source = pattern.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  if (/^\/|^[a-z]:/i.test(source))
    return "The pattern must be relative to the folder searched, not an absolute path.";
  if (source.split("/").includes(".."))
    return "The pattern cannot leave the folder searched; choose a different folder with path instead.";
  let expression = "";
  let inBraces = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === "*" && source[index + 1] === "*") {
      const before = index === 0 || source[index - 1] === "/";
      const after = source[index + 2];
      if (before && after === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else if (character === "{") {
      if (inBraces) return "Alternatives in braces cannot be nested.";
      inBraces = true;
      expression += "(?:";
    } else if (character === "}" && inBraces) {
      inBraces = false;
      expression += ")";
    } else if (character === "," && inBraces) expression += "|";
    else expression += character.replace(/[.+^$()|[\]{}\\]/g, "\\$&");
  }
  if (inBraces) return "A brace in the pattern is not closed.";
  const whole = new RegExp(`^${expression}$`, "i");
  const byName = !source.includes("/");
  return {
    test: (relativePath) =>
      whole.test(
        byName
          ? relativePath.slice(relativePath.lastIndexOf("/") + 1)
          : relativePath,
      ),
  };
}

function findArguments(args: unknown): FindArguments | string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const source = args as Record<string, unknown>;
  if (
    Object.keys(source).some(
      (key) => !["pattern", "path", "includeIgnored"].includes(key),
    )
  )
    return;
  const includeIgnored = source["includeIgnored"] ?? false;
  if (typeof includeIgnored !== "boolean") return;
  const pattern = source["pattern"];
  if (typeof pattern !== "string" || !pattern.trim()) return;
  if (pattern.length > maximumPatternLength) return;
  const path = source["path"] ?? ".";
  if (typeof path !== "string" || !path.trim()) return;
  const matcher = compile(pattern.trim());
  if (typeof matcher === "string") return matcher;
  return {
    pattern: pattern.trim(),
    path: normalizePath(path),
    includeIgnored,
    matcher,
  };
}

export function inspectFindFiles(
  root: string,
  args: unknown,
): ToolCallInspection {
  const input = findArguments(args);
  if (typeof input !== "object") {
    return {
      ok: false,
      reason:
        input ?? "Choose a name pattern and a folder inside the workspace.",
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
    action: "Find workspace files by name",
    target:
      input.path === "." ? input.pattern : `${input.pattern} in ${input.path}`,
    access: "read",
    scope: "workspace",
    command: `find_files(${JSON.stringify({ pattern: input.pattern, path: input.path, includeIgnored: input.includeIgnored })})`,
  };
}

type Found = {
  readonly path: string;
  readonly kind: "file" | "folder";
  readonly size?: number;
  readonly modified?: string;
};

export type FindContext = RipgrepContext;

export async function runFindFiles(
  root: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: FindContext,
): Promise<ToolInvocationResult> {
  const inspected = inspectFindFiles(root, args);
  if (!inspected.ok) return inspected;
  const input = findArguments(args);
  if (typeof input !== "object")
    return { ok: false, reason: "The search input is invalid." };

  try {
    const realRoot = await realpath(root);
    const base = await realpath(resolve(realRoot, input.path));
    if (scopeOf(realRoot, base) !== "workspace") {
      return {
        ok: false,
        reason: "The search must stay inside the current workspace.",
      };
    }
    const prefix = input.path === "." ? "" : `${input.path}/`;
    const files: string[] = [];
    const run = await ripgrep({
      ...context,
      cwd: realRoot,
      signal,
      args: [
        "--files",
        "--path-separator",
        "/",
        ...selection(input.includeIgnored),
        "--",
        input.path,
      ],
      line: (text) => {
        const path = printedPath(text);
        if (path)
          files.push(
            path.startsWith(prefix) ? path.slice(prefix.length) : path,
          );
      },
    });
    if (run.cancelled)
      return { ok: false, reason: "The search was cancelled." };
    if (run.exitCode === 2 && !files.length)
      return { ok: false, reason: "The workspace could not be searched." };

    const folders = new Set<string>();
    for (const file of files)
      for (let at = file.indexOf("/"); at > 0; at = file.indexOf("/", at + 1))
        folders.add(file.slice(0, at));
    const found = [
      ...files.map((path) => ({ path, folder: false })),
      ...[...folders].map((path) => ({ path, folder: true })),
    ]
      .filter((entry) => input.matcher.test(entry.path))
      .sort((left, right) => byPath(left.path, right.path));
    const matches = await Promise.all(
      found
        .slice(0, maximumMatches)
        .map((entry) =>
          described(
            resolve(base, entry.path),
            prefix + entry.path,
            entry.folder,
          ),
        ),
    );
    const complete = run.complete;
    const shown = matches.length < found.length;
    return {
      ok: true,
      value: {
        pattern: input.pattern,
        matches,
        ...(complete ? { total: found.length } : { atLeast: found.length }),
        notSearched: [
          ...skippedFolders,
          ...(input.includeIgnored
            ? []
            : ["files .gitignore lists", "hidden files"]),
        ],
      },
      ...detailsOf({
        kind: "list",
        label: complete
          ? `${found.length} found${shown ? `, first ${matches.length} shown` : ""}`
          : `At least ${found.length} found; the listing was cut short`,
        items: matches.map(
          (match) => `${match.path}${match.kind === "folder" ? "/" : ""}`,
        ),
        ...(shown || !complete ? { truncated: true } : {}),
      }),
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

async function described(
  absolute: string,
  path: string,
  folder: boolean,
): Promise<Found> {
  const shown = toForwardSlashes(path);
  if (folder) return { path: shown, kind: "folder" };
  try {
    const entry = await stat(absolute);
    return {
      path: shown,
      kind: "file",
      size: entry.size,
      modified: entry.mtime.toISOString(),
    };
  } catch {
    return { path: shown, kind: "file" };
  }
}
