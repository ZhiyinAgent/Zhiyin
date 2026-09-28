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
 * The search is literal, not a pattern language. A model asking for text it
 * read somewhere should find that text; a regular expression would add a
 * second dialect to get wrong and a way to spend the whole budget on one file.
 */

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts } from "./action-detail.js";
import {
  errorCode,
  isAbortError,
  normalizePath,
  scopeOf,
  toForwardSlashes,
} from "./workspace-path.js";

/** Bounds, so one search cannot become an unbounded scan of a large tree. */
const maximumResults = 100;
const maximumFiles = 2000;
const maximumFileBytes = 1024 * 1024;
const maximumLineLength = 300;
const maximumQueryLength = 400;

/**
 * Folders whose contents are machine-generated or private to a tool. Searching
 * them buries the answer rather than finding it, and the result names them so
 * it never implies the search covered everything.
 */
const skippedFolders = [
  ".git",
  ".next",
  ".venv",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "out",
];
const skipped = new Set(skippedFolders);

export const searchFilesSpec: ToolSpec = {
  access: "read",
  name: "search_files",
  description:
    "Find which text files in the current workspace contain a piece of text. Matching is literal and ignores letter case. Generated folders such as .git and node_modules are not searched.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The exact text to look for.",
      },
      path: {
        type: "string",
        description:
          "Workspace-relative folder to search in. Defaults to the whole workspace.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

type SearchArguments = { readonly query: string; readonly path: string };

function searchArguments(args: unknown): SearchArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const source = args as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "query" && key !== "path"))
    return;
  const query = source["query"];
  if (typeof query !== "string" || !query.trim()) return;
  if (query.length > maximumQueryLength) return;
  const path = source["path"] ?? ".";
  if (typeof path !== "string" || !path.trim()) return;
  return { query, path: normalizePath(path) };
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

/** A NUL byte is the cheap, reliable sign that this is not text to search. */
function looksBinary(text: string): boolean {
  return text.includes("\u0000");
}

export async function runSearchFiles(
  root: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<ToolInvocationResult> {
  const inspected = inspectSearchFiles(root, args);
  if (!inspected.ok) return inspected;
  const input = searchArguments(args);
  if (!input) return { ok: false, reason: "The search input is invalid." };

  const needle = input.query.toLowerCase();
  const matches: Match[] = [];
  let filesRead = 0;
  let truncated = false;

  try {
    const realRoot = await realpath(root);
    const base = await realpath(resolve(realRoot, input.path));
    if (scopeOf(realRoot, base) !== "workspace") {
      return {
        ok: false,
        reason: "The search must stay inside the current workspace.",
      };
    }

    const visit = async (
      directory: string,
      relativeDirectory: string,
    ): Promise<void> => {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (truncated) return;
      let children;
      try {
        children = await readdir(directory, { withFileTypes: true });
      } catch {
        // An unreadable folder is not a failed search; it is one folder the
        // search could not see, and the answer stands for the rest.
        return;
      }
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        if (truncated) return;
        if (skipped.has(child.name)) continue;
        // A link is the one entry that can lead out of the workspace, and this
        // tool told the permission engine it would not.
        if (child.isSymbolicLink()) continue;
        const childPath =
          relativeDirectory === "."
            ? child.name
            : `${relativeDirectory}/${child.name}`;
        const absolute = resolve(directory, child.name);
        if (child.isDirectory()) {
          await visit(absolute, childPath);
          continue;
        }
        if (!child.isFile()) continue;
        if (filesRead >= maximumFiles) {
          truncated = true;
          return;
        }
        let entry;
        try {
          entry = await stat(absolute);
        } catch {
          continue;
        }
        if (entry.size > maximumFileBytes) continue;
        filesRead += 1;
        let text;
        try {
          text = await readFile(absolute, "utf8");
        } catch (error) {
          if (isAbortError(error)) throw error;
          continue;
        }
        if (looksBinary(text) || !text.toLowerCase().includes(needle)) continue;
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (!line.toLowerCase().includes(needle)) continue;
          if (matches.length >= maximumResults) {
            truncated = true;
            return;
          }
          matches.push({
            path: toForwardSlashes(childPath),
            line: index + 1,
            text:
              line.length > maximumLineLength
                ? `${line.slice(0, maximumLineLength)}…`
                : line,
          });
        }
      }
    };

    await visit(base, input.path);
    return {
      ok: true,
      value: {
        query: input.query,
        matches,
        filesRead,
        truncated,
        notSearched: skippedFolders,
      },
      ...detailsOf(
        facts(
          ["Looking for", input.query],
          ["Files read", filesRead],
          ["Matches", matches.length],
        ),
        {
          kind: "matches",
          items: matches,
          ...(truncated ? { truncated: true } : {}),
          note: `Not searched: ${skippedFolders.join(", ")}.`,
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
