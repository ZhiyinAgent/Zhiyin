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

import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
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
  notSearchedIn,
  searchingFolder,
  type RipgrepContext,
} from "./ripgrep.js";
import {
  errorCode,
  isAbortError,
  normalizePath,
  realLocation,
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
    "Find files and folders in the current workspace by name. A pattern without a slash matches names at any depth, such as '*.pdf' or 'budget*'; a pattern with a slash matches the path from the folder searched, such as 'Invoices/**/*.pdf'. '*' and '?' match within a name, '**' across folders, '{docx,xlsx}' either alternative. Letter case is ignored. Files the workspace's .gitignore lists and hidden files are not searched unless includeIgnored is true. Nor are folders that usually hold generated files, such as node_modules, build and dist, unless includeIgnored is true or the folder searched is one of them; .git is searched only when it is the folder searched. The answer says how many matched in all.",
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
          "Also find files .gitignore lists, hidden files, and folders of generated files. Defaults to false.",
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

/**
 * One character with its letter case set aside, as a regular expression that
 * ignores case compares them: by its capital, unless that is more than one
 * character or turns a letter beyond ASCII into an ASCII one.
 */
function folded(character: string): string {
  const capital = character.toUpperCase();
  return capital.length !== 1 ||
    (character.charCodeAt(0) >= 128 && capital.charCodeAt(0) < 128)
    ? character
    : capital;
}

/** What one step of a pattern takes: a character, any but "/", or any. */
type Step = string | typeof notSlash | typeof anything;
const notSlash = Symbol("not a slash");
const anything = Symbol("anything");

type State = {
  readonly steps: { readonly takes: Step; readonly to: number }[];
  readonly free: number[];
};

/**
 * The pattern as a set of states a name moves through one character at a
 * time, or a reason it cannot be one. A name is matched by following every
 * state it could be in at once, so the time is the name's length times the
 * pattern's, whatever wildcards the pattern holds: a regular expression of
 * many wildcards backtracks exponentially on a name that does not match.
 */
function compile(pattern: string): Matcher | string {
  const source = pattern.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  if (/^\/|^[a-z]:/i.test(source))
    return "The pattern must be relative to the folder searched, not an absolute path.";
  if (source.split("/").includes(".."))
    return "The pattern cannot leave the folder searched; choose a different folder with path instead.";
  const states: State[] = [];
  const add = () => states.push({ steps: [], free: [] }) - 1;
  const state = (index: number) => states[index]!;
  let current = add();
  const step = (takes: Step) => {
    const next = add();
    state(current).steps.push({ takes, to: next });
    current = next;
  };
  const loop = (takes: Step) => {
    const repeated = add();
    state(current).free.push(repeated);
    state(repeated).steps.push({ takes, to: repeated });
    current = repeated;
  };
  let braces: { readonly fork: number; readonly join: number } | undefined;
  const characters = [...source];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (character === "*" && characters[index + 1] === "*") {
      const before = index === 0 || characters[index - 1] === "/";
      if (before && characters[index + 2] === "/") {
        // "**/" is any number of whole folders, none included.
        const after = add();
        state(current).free.push(after);
        loop(anything);
        state(current).steps.push({ takes: "/", to: after });
        current = after;
        index += 2;
      } else {
        loop(anything);
        index += 1;
      }
    } else if (character === "*") loop(notSlash);
    else if (character === "?") step(notSlash);
    else if (character === "{") {
      if (braces) return "Alternatives in braces cannot be nested.";
      braces = { fork: current, join: add() };
      current = add();
      state(braces.fork).free.push(current);
    } else if (character === "}" && braces) {
      state(current).free.push(braces.join);
      current = braces.join;
      braces = undefined;
    } else if (character === "," && braces) {
      state(current).free.push(braces.join);
      current = add();
      state(braces.fork).free.push(current);
    } else step(folded(character));
  }
  if (braces) return "A brace in the pattern is not closed.";
  const accepting = current;
  const byName = !source.includes("/");
  return {
    test: (relativePath) => {
      const name = byName
        ? relativePath.slice(relativePath.lastIndexOf("/") + 1)
        : relativePath;
      let now = new Set<number>();
      const reach = (into: Set<number>, from: number) => {
        if (into.has(from)) return;
        into.add(from);
        for (const free of state(from).free) reach(into, free);
      };
      reach(now, 0);
      for (const character of name) {
        const letter = folded(character);
        const next = new Set<number>();
        for (const at of now)
          for (const { takes, to } of state(at).steps)
            if (
              takes === anything ||
              (takes === notSlash ? letter !== "/" : takes === letter)
            )
              reach(next, to);
        if (!next.size) return false;
        now = next;
      }
      return now.has(accepting);
    },
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
    const real = await realLocation(root, input.path);
    const realRoot = real.root;
    const base = real.path;
    if (real.scope !== "workspace") {
      return {
        ok: false,
        reason: "The search must stay inside the current workspace.",
      };
    }
    if (!(await stat(base)).isDirectory())
      return {
        ok: false,
        reason: `${input.path} is a file, not a folder. Search the folder it is in.`,
      };
    // Named by where it really is, so however the model wrote the folder
    // (`src/`, `./src`), what ripgrep prints starts with this.
    const folder = toForwardSlashes(relative(realRoot, base));
    const prefix = folder ? `${folder}/` : "";
    const files: string[] = [];
    const run = await searchingFolder(folder, input.includeIgnored, (search) =>
      ripgrep({
        ...context,
        cwd: realRoot,
        signal,
        args: [
          "--files",
          "--path-separator",
          "/",
          ...search.args,
          "--",
          search.path,
        ],
        line: (text) => {
          const path = printedPath(text);
          if (path && search.inside(path))
            files.push(
              path.startsWith(prefix) ? path.slice(prefix.length) : path,
            );
        },
      }),
    );
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
        notSearched: notSearchedIn(folder, input.includeIgnored),
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
