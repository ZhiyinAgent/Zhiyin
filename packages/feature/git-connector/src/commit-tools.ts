/** What the next commit holds, and making it: `git_stage` and `git_commit`. */

import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { shortened } from "@zhiyin/text-and-names";
import { runGit } from "./run-git.js";
import {
  argumentsInspection,
  changeOutput,
  commandLine,
  errorResult,
  isSafeArgument,
  textResult,
  type GitCall,
  type GitToolDefinition,
} from "./git-tool.js";
import {
  changedEntries,
  indexEntries,
  reader,
  standing,
} from "./resulting-state.js";

function pathsArgument(args: unknown): readonly string[] | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["paths"]
      : undefined;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((item): item is string => typeof item === "string"))
    return undefined;
  return value;
}

export const stageTool: GitToolDefinition = {
  spec: {
    name: "git_stage",
    label: "Stage changes",
    description:
      "Stage one or more files, adding their current content to the next commit. The answer names the files whose staged content changed and shows what is staged now; staging that changes nothing is an error.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Workspace-relative paths to stage.",
        },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  access: "change",
  async inspect(_call, args) {
    const paths = pathsArgument(args);
    if (!paths || !paths.every(isSafeArgument))
      return argumentsInspection("Name one or more real paths to stage.");
    return {
      ok: true,
      // A path can be a folder or a pattern, so it is never counted as a file.
      action: `Stage ${paths.length} path${paths.length === 1 ? "" : "s"}`,
      target: paths.join(", "),
      detail: `Adds the current content of ${paths.join(", ")} to what the next commit will include. A folder or pattern adds every file under it, apart from new files git ignores. Nothing is committed yet.`,
      command: commandLine(["add", "--", ...paths]),
      access: "change",
      // Staging runs the repository's own filters with the account's full
      // access, so no grant covers it (ADR 0012).
      asksEachTime: true,
    };
  },
  async execute(call, args) {
    const paths = pathsArgument(args);
    if (!paths || !paths.every(isSafeArgument))
      return errorResult("Name one or more real paths to stage.");
    const read = reader(call);
    const before = await indexEntries(read, paths);
    const ran = await changeOutput(call, ["add", "--", ...paths]);
    if ("failed" in ran) return ran.failed;
    const after = await indexEntries(read, paths);
    if (!before || !after)
      return textResult(
        `${ran.text}\ngit ran, but what is staged now could not be read.`.trim(),
      );
    const changed = changedEntries(before, after);
    if (!changed.length)
      return errorResult(
        `Staging changed nothing: what is staged for ${paths.join(", ")} already matches the files.`,
      );
    const stat = await read([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--cached",
      "--stat",
    ]);
    const named =
      changed.length > maximumNamed
        ? `${changed.slice(0, maximumNamed).join(", ")} and ${changed.length - maximumNamed} more`
        : changed.join(", ");
    return textResult(
      [
        `Staged ${changed.length} file${changed.length === 1 ? "" : "s"}: ${named}.`,
        stat?.trimEnd()
          ? `Staged now, for the next commit:\n${stat.trimEnd()}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
};

/** Files a staging names by path; the rest are counted. */
const maximumNamed = 20;

/** The hooks a commit can run, by the name git looks for. */
const commitHooks = [
  "pre-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "post-index-change",
  "reference-transaction",
  // A commit can start git's upkeep, which runs this first.
  "pre-auto-gc",
];

/**
 * The hooks a commit here would run: those in the folder git looks in, which
 * follows `core.hooksPath`, as Git for Windows finds them, with or without
 * `.exe`, and those named in settings for a commit's events. Nothing when
 * they cannot be told, as for a folder on another computer, which is never
 * looked at before approval. Asking where hooks are looked for starts
 * nothing, so it is asked as git runs; the settings are read as any read is.
 */
async function hooksACommitRuns(
  call: GitCall,
): Promise<readonly string[] | undefined> {
  const folder = await runGit(
    call.git,
    call.root,
    ["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
    undefined,
    call.containment,
  );
  const hooksFolder = folder.stdout.trim();
  if (folder.exitCode !== 0 || folder.ending || /^[\\/]{2}/.test(hooksFolder))
    return undefined;
  const configured = await call.read([
    "config",
    "-z",
    "--get-regexp",
    "^hook\\..+\\.event$",
  ]);
  if (
    configured.ending ||
    (configured.exitCode !== 0 && configured.exitCode !== 1)
  )
    return undefined;
  const events = configured.stdout
    .split("\0")
    .map((entry) => entry.slice(entry.indexOf("\n") + 1));
  const isFile = async (path: string) =>
    (await stat(path).catch(() => undefined))?.isFile() ?? false;
  const inFolder = await Promise.all(
    commitHooks.map(async (name) =>
      (await isFile(join(hooksFolder, name))) ||
      (await isFile(join(hooksFolder, `${name}.exe`)))
        ? name
        : undefined,
    ),
  );
  return commitHooks.filter(
    (name) => inFolder.includes(name) || events.includes(name),
  );
}

function commitMessage(args: unknown): string | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["message"]
      : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export const commitTool: GitToolDefinition = {
  spec: {
    name: "git_commit",
    label: "Commit the staged changes",
    description:
      "Commit everything currently staged, with the given message. The answer gives the commit made, the branch it is on and what is left uncommitted.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The commit message." },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  access: "change",
  async inspect(call, args) {
    const { root } = call;
    const message = commitMessage(args);
    if (!message)
      return argumentsInspection("Give a non-empty commit message.");
    const staged = await call.read([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--staged",
      "--stat",
    ]);
    const summary = staged.stdout.trim();
    const hooks = await hooksACommitRuns(call);
    const running =
      hooks === undefined
        ? "\n\nAny commit hooks it has run with it, with your account's full access, and can change what is committed."
        : hooks.length
          ? `\n\nIts commit hooks (${hooks.join(", ")}) run with it, with your account's full access, and can change what is committed.`
          : "";
    return {
      ok: true,
      action: "Commit the staged changes",
      target: basename(root),
      // The hooks run whatever is staged, even before git refuses an empty
      // commit, so every case names them.
      detail: `${
        staged.ending
          ? "What is staged could not be read in time. The commit takes whatever is staged when it runs."
          : summary
            ? `Commits what is staged:\n${shortened(summary.trim(), 2_000)}`
            : "Nothing is staged. This commit would be empty and git will refuse it."
      }${running}`,
      command: commandLine(["commit", "-m", message]),
      access: "change",
      // Committing runs the repository's own hooks with the account's full
      // access, so no grant covers it (ADR 0012).
      asksEachTime: true,
    };
  },
  async execute(call, args) {
    const message = commitMessage(args);
    if (!message) return errorResult("Give a non-empty commit message.");
    const ran = await changeOutput(call, ["commit", "-m", message]);
    if ("failed" in ran) return ran.failed;
    const { said } = await standing(reader(call));
    return textResult(`${ran.text}\n${said}`.trim());
  },
};
