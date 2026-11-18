/** The work tree's state: `git_status` and `git_diff`. */

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  argumentsInspection,
  commandLine,
  errorResult,
  isSafeArgument,
  narrowedTo,
  pathsAsked,
  pathsProperty,
  pathsRefused,
  readAnswer,
  readOutput,
  textResult,
  type GitCall,
  type GitToolDefinition,
  type GitToolResult,
} from "./git-tool.js";

/**
 * Status and diff look inside no submodule (`--ignore-submodules=dirty`), so
 * a repository that has any says what is left out of their answer.
 */
function sayingSubmodulesUnseen(
  result: GitToolResult,
  top: string,
): GitToolResult {
  if (result.isError || !existsSync(join(top, ".gitmodules"))) return result;
  return textResult(
    `${result.content.map((part) => part.text).join("\n")}\nChanges inside submodules' own files are not shown.`,
  );
}

export const statusTool: GitToolDefinition = {
  spec: {
    name: "git_status",
    label: "Check the status of the git repository",
    description:
      "Show which files in the workspace have changed, are staged, or are untracked.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  access: "read",
  async inspect({ root }) {
    return {
      ok: true,
      action: "Check the status of the git repository",
      target: basename(root),
      command: "git status",
      access: "read",
    };
  },
  async execute(call) {
    return sayingSubmodulesUnseen(
      await readAnswer(call, [
        "status",
        "--porcelain=v1",
        "-b",
        "--ignore-submodules=dirty",
      ]),
      call.top,
    );
  },
};

/** What a diff is asked to show. */
type DiffAsked = {
  readonly staged: boolean;
  readonly stat: boolean;
  readonly base?: string;
  readonly paths: readonly string[];
};

function diffAsked(
  args: unknown,
):
  | { readonly ok: true; readonly asked: DiffAsked }
  | { readonly ok: false; readonly reason: string } {
  const record =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)
      : {};
  const base = record["base"];
  if (base !== undefined && (typeof base !== "string" || !isSafeArgument(base)))
    return {
      ok: false,
      reason: "Name a real commit, branch, or tag as base.",
    };
  const paths = pathsAsked(record);
  if (!paths) return { ok: false, reason: pathsRefused };
  return {
    ok: true,
    asked: {
      staged: record["staged"] === true,
      stat: record["stat"] === true,
      ...(base !== undefined ? { base: base as string } : {}),
      paths,
    },
  };
}

/** The diff as the person reads it: what was asked, in git's own words. */
function diffArguments(asked: DiffAsked): readonly string[] {
  return [
    "diff",
    ...(asked.stat ? ["--stat"] : []),
    ...(asked.staged ? ["--staged"] : []),
    ...(asked.base !== undefined ? [asked.base] : []),
    ...narrowedTo(asked.paths),
  ];
}

/**
 * The new files git does not track, which no diff shows, apart from those
 * it ignores, in the paths asked.
 */
async function untracked(
  call: GitCall,
  paths: readonly string[],
): Promise<
  { readonly files: readonly string[] } | { readonly failed: GitToolResult }
> {
  const read = await readOutput(call, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    ...narrowedTo(paths),
  ]);
  if ("failed" in read) return read;
  return { files: read.text.split("\0").filter(Boolean) };
}

export const diffTool: GitToolDefinition = {
  spec: {
    name: "git_diff",
    label: "Show the changes",
    description:
      "Show the changes to tracked files: the unstaged ones, or the staged ones when `staged` is true. `base` shows every change since that commit, branch or tag, committed or not; `stat` shows how many lines each file changed instead of the changes; `paths` narrows to some files or folders. Without `staged`, new files git does not track yet are named after the diff.",
    inputSchema: {
      type: "object",
      properties: {
        staged: {
          type: "boolean",
          description: "Show staged changes instead of unstaged ones.",
        },
        base: {
          type: "string",
          minLength: 1,
          description:
            "A commit, branch or tag to compare with, such as main or HEAD~3.",
        },
        stat: {
          type: "boolean",
          description:
            "Show how many lines each file changed, without the changes.",
        },
        paths: pathsProperty,
      },
      additionalProperties: false,
    },
  },
  access: "read",
  async inspect({ root }, args) {
    const read = diffAsked(args);
    if (!read.ok) return argumentsInspection(read.reason);
    const { asked } = read;
    return {
      ok: true,
      action:
        asked.base !== undefined
          ? `Show the ${asked.staged ? "staged " : ""}changes since ${asked.base}`
          : asked.staged
            ? "Show staged changes"
            : "Show unstaged changes",
      target: asked.paths.length ? asked.paths.join(", ") : basename(root),
      command: commandLine(diffArguments(asked)),
      access: "read",
    };
  },
  async execute(call, args) {
    const read = diffAsked(args);
    if (!read.ok) return errorResult(read.reason);
    const { asked } = read;
    const [command, ...rest] = diffArguments(asked);
    const diff = await readOutput(call, [
      command as string,
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=dirty",
      ...rest,
    ]);
    if ("failed" in diff) return diff.failed;
    const lines = [diff.text.trim() || "No changes to tracked files."];
    if (!asked.staged) {
      const found = await untracked(call, asked.paths);
      if ("failed" in found) return found.failed;
      const count = found.files.length;
      if (count)
        lines.push(
          `${count} new file${count === 1 ? "" : "s"} git does not track yet, so not in the diff: ${found.files.join(", ")}`,
        );
    }
    return sayingSubmodulesUnseen(textResult(lines.join("\n")), call.top);
  },
};
