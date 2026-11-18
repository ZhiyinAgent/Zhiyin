/** The commits: `git_log` and `git_show`. */

import { basename } from "node:path";
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
  type GitToolDefinition,
} from "./git-tool.js";

function logLimit(args: unknown): number {
  const raw =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["limit"]
      : undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return 20;
  return Math.min(Math.max(raw, 1), 200);
}

export const logTool: GitToolDefinition = {
  spec: {
    name: "git_log",
    label: "Show commits",
    description:
      "Show the most recent commits, newest first, or only those that changed the `paths` given.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "How many commits to show. Defaults to 20.",
        },
        paths: pathsProperty,
      },
      additionalProperties: false,
    },
  },
  access: "read",
  async inspect({ root }, args) {
    const limit = logLimit(args);
    const paths = pathsAsked(args);
    if (!paths) return argumentsInspection(pathsRefused);
    return {
      ok: true,
      action: `Show the last ${limit} commit${limit === 1 ? "" : "s"}${paths.length ? ` that changed ${paths.join(", ")}` : ""}`,
      target: basename(root),
      command: commandLine(["log", "-n", String(limit), ...narrowedTo(paths)]),
      access: "read",
    };
  },
  async execute(call, args) {
    const limit = logLimit(args);
    const paths = pathsAsked(args);
    if (!paths) return errorResult(pathsRefused);
    return readAnswer(call, [
      "log",
      `-n${limit}`,
      "--pretty=format:%h %ad %an: %s",
      "--date=short",
      ...narrowedTo(paths),
    ]);
  },
};

function refArgument(args: unknown): string | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["ref"]
      : undefined;
  return typeof value === "string" ? value : undefined;
}

function statAsked(args: unknown): boolean {
  return (
    typeof args === "object" &&
    args !== null &&
    (args as Record<string, unknown>)["stat"] === true
  );
}

const refRefused = "Name a real commit, branch, or tag to show.";

export const showTool: GitToolDefinition = {
  spec: {
    name: "git_show",
    label: "Show a commit",
    description:
      "Show one commit's message and the changes it made, by hash, branch, or tag. `stat` shows how many lines each file changed instead of the changes; `paths` narrows the changes to some files or folders.",
    inputSchema: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "The commit, branch, or tag to show.",
        },
        stat: {
          type: "boolean",
          description:
            "Show how many lines each file changed, without the changes.",
        },
        paths: pathsProperty,
      },
      required: ["ref"],
      additionalProperties: false,
    },
  },
  access: "read",
  async inspect({ root }, args) {
    const ref = refArgument(args);
    if (!ref || !isSafeArgument(ref)) return argumentsInspection(refRefused);
    const paths = pathsAsked(args);
    if (!paths) return argumentsInspection(pathsRefused);
    return {
      ok: true,
      action: `Show ${ref}`,
      target: paths.length ? paths.join(", ") : basename(root),
      command: commandLine([
        "show",
        ...(statAsked(args) ? ["--stat"] : []),
        ref,
        ...narrowedTo(paths),
      ]),
      access: "read",
    };
  },
  async execute(call, args) {
    const ref = refArgument(args);
    if (!ref || !isSafeArgument(ref)) return errorResult(refRefused);
    const paths = pathsAsked(args);
    if (!paths) return errorResult(pathsRefused);
    // `ref` is already refused when it could be read as a flag
    // (`isSafeArgument`), and comes before any `--`, which would instead
    // tell git to treat it as a pathspec rather than a revision.
    return readAnswer(call, [
      "show",
      "--no-ext-diff",
      "--no-textconv",
      ...(statAsked(args) ? ["--stat"] : []),
      ref,
      ...narrowedTo(paths),
    ]);
  },
};
