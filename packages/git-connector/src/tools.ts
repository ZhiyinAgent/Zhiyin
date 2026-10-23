import { existsSync } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  ActionDetail,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import type { GitContainment } from "./run-git.js";
import { endings, readGit, runGit } from "./run-git.js";

export type GitToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
};

type GitToolResult = {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
};

type GitToolDefinition = {
  readonly spec: GitToolSpec;
  readonly access: "read" | "change";
  inspect(
    root: string,
    args: unknown,
    git: string,
    containment: GitContainment | undefined,
    /** The work tree git acts on, when git could say. */
    top: string | undefined,
  ): Promise<ToolCallInspection>;
  execute(
    git: string,
    root: string,
    args: unknown,
    signal: AbortSignal | undefined,
    containment: GitContainment | undefined,
  ): Promise<GitToolResult>;
};

function shortened(value: string, maximum = 4_000): string {
  const trimmed = value.trim();
  return trimmed.length > maximum ? `${trimmed.slice(0, maximum)}…` : trimmed;
}

function textResult(text: string): GitToolResult {
  return { content: [{ type: "text", text: text || "(no output)" }] };
}

function errorResult(text: string): GitToolResult {
  return {
    content: [{ type: "text", text: text || "git reported an error." }],
    isError: true,
  };
}

/**
 * A call that changes the repository runs as git would run it for the person,
 * with the repository's hooks and filters; one that only reads runs none of
 * the programs its settings name (`readGit`).
 */
async function invoke(
  git: string,
  root: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
  containment: GitContainment | undefined,
  reading = false,
): Promise<GitToolResult> {
  const { exitCode, stdout, stderr, ending } = await (
    reading ? readGit : runGit
  )(git, root, args, signal, containment);
  // Ended by Zhiyin, not by git: said as such, with whatever git printed.
  if (ending)
    return errorResult(
      [endings[ending], shortened(stderr || stdout)].filter(Boolean).join("\n"),
    );
  if (exitCode !== 0) return errorResult(shortened(stderr || stdout));
  return textResult(shortened(stdout));
}

/**
 * A ref, path, or similar user-influenced argument never starts with `-`:
 * that would let it be read as a git option instead of the value it is
 * supposed to be, the same risk `git <command> -- <path>` guards against.
 */
function isSafeArgument(value: string): boolean {
  return value.length > 0 && !value.startsWith("-");
}

/**
 * A refusal of a call's arguments. It names the input at fault when a repair
 * may change it: a reference or a path, never a message (ADR 0010).
 */
function argumentsInspection(
  reason: string,
  ...faulty: string[]
): ToolCallInspection {
  return {
    ok: false,
    correctable: true,
    reason,
    ...(faulty.length ? { faulty } : {}),
  };
}

/**
 * Status and diff look inside no submodule (`--ignore-submodules=dirty`), so
 * a repository that has any says what is left out of their answer.
 */
async function sayingSubmodulesUnseen(
  result: GitToolResult,
  git: string,
  root: string,
  signal: AbortSignal | undefined,
  containment: GitContainment | undefined,
): Promise<GitToolResult> {
  if (result.isError) return result;
  const top = await readGit(
    git,
    root,
    ["rev-parse", "--show-toplevel"],
    signal,
    containment,
  );
  if (
    top.exitCode !== 0 ||
    top.ending ||
    !existsSync(join(top.stdout.trim(), ".gitmodules"))
  )
    return result;
  return textResult(
    `${result.content.map((part) => part.text).join("\n")}\nChanges inside submodules' own files are not shown.`,
  );
}

const statusTool: GitToolDefinition = {
  spec: {
    name: "git_status",
    description:
      "Show which files in the workspace have changed, are staged, or are untracked.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  access: "read",
  async inspect(root) {
    return {
      ok: true,
      action: "Check the status of the git repository",
      target: basename(root),
      command: "git status",
      access: "read",
    };
  },
  async execute(git, root, _args, signal, containment) {
    return sayingSubmodulesUnseen(
      await invoke(
        git,
        root,
        ["status", "--porcelain=v1", "-b", "--ignore-submodules=dirty"],
        signal,
        containment,
        true,
      ),
      git,
      root,
      signal,
      containment,
    );
  },
};

const diffTool: GitToolDefinition = {
  spec: {
    name: "git_diff",
    description:
      "Show the current unstaged changes, or the staged ones when `staged` is true.",
    inputSchema: {
      type: "object",
      properties: {
        staged: {
          type: "boolean",
          description: "Show staged changes instead of unstaged ones.",
        },
      },
      additionalProperties: false,
    },
  },
  access: "read",
  async inspect(root, args) {
    const staged =
      typeof args === "object" &&
      args !== null &&
      (args as Record<string, unknown>)["staged"] === true;
    return {
      ok: true,
      action: staged ? "Show staged changes" : "Show unstaged changes",
      target: basename(root),
      command: staged ? "git diff --staged" : "git diff",
      access: "read",
    };
  },
  async execute(git, root, args, signal, containment) {
    const staged =
      typeof args === "object" &&
      args !== null &&
      (args as Record<string, unknown>)["staged"] === true;
    return sayingSubmodulesUnseen(
      await invoke(
        git,
        root,
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--ignore-submodules=dirty",
          ...(staged ? ["--staged"] : []),
        ],
        signal,
        containment,
        true,
      ),
      git,
      root,
      signal,
      containment,
    );
  },
};

function logLimit(args: unknown): number {
  const raw =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["limit"]
      : undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return 20;
  return Math.min(Math.max(raw, 1), 200);
}

const logTool: GitToolDefinition = {
  spec: {
    name: "git_log",
    description: "Show the most recent commits, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "How many commits to show. Defaults to 20.",
        },
      },
      additionalProperties: false,
    },
  },
  access: "read",
  async inspect(root, args) {
    const limit = logLimit(args);
    return {
      ok: true,
      action: `Show the last ${limit} commit${limit === 1 ? "" : "s"}`,
      target: basename(root),
      command: `git log -n ${limit}`,
      access: "read",
    };
  },
  async execute(git, root, args, signal, containment) {
    const limit = logLimit(args);
    return invoke(
      git,
      root,
      ["log", `-n${limit}`, "--pretty=format:%h %ad %an: %s", "--date=short"],
      signal,
      containment,
      true,
    );
  },
};

function refArgument(args: unknown): string | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["ref"]
      : undefined;
  return typeof value === "string" ? value : undefined;
}

const showTool: GitToolDefinition = {
  spec: {
    name: "git_show",
    description:
      "Show one commit's message and the changes it made, by hash, branch, or tag.",
    inputSchema: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "The commit, branch, or tag to show.",
        },
      },
      required: ["ref"],
      additionalProperties: false,
    },
  },
  access: "read",
  async inspect(root, args) {
    const ref = refArgument(args);
    if (!ref || !isSafeArgument(ref))
      return argumentsInspection(
        "Name a real commit, branch, or tag to show.",
        "ref",
      );
    return {
      ok: true,
      action: `Show ${ref}`,
      target: basename(root),
      command: `git show ${ref}`,
      access: "read",
    };
  },
  async execute(git, root, args, signal, containment) {
    const ref = refArgument(args);
    if (!ref || !isSafeArgument(ref))
      return errorResult("Name a real commit, branch, or tag to show.");
    // `ref` is already refused when it could be read as a flag
    // (`isSafeArgument`), so this needs no `--` — which would instead tell
    // git to treat `ref` as a pathspec rather than a revision.
    return invoke(
      git,
      root,
      ["show", "--no-ext-diff", "--no-textconv", ref],
      signal,
      containment,
      true,
    );
  },
};

const branchTool: GitToolDefinition = {
  spec: {
    name: "git_branch",
    description: "List local branches and show which one is checked out.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  access: "read",
  async inspect(root) {
    return {
      ok: true,
      action: "List branches",
      target: basename(root),
      command: "git branch",
      access: "read",
    };
  },
  async execute(git, root, _args, signal, containment) {
    return invoke(git, root, ["branch", "--list"], signal, containment, true);
  },
};

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

const stageTool: GitToolDefinition = {
  spec: {
    name: "git_stage",
    description:
      "Stage one or more files, adding their current content to the next commit.",
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
  async inspect(_root, args) {
    const paths = pathsArgument(args);
    if (!paths || !paths.every(isSafeArgument))
      return argumentsInspection(
        "Name one or more real paths to stage.",
        "paths",
      );
    return {
      ok: true,
      // A path can be a folder or a pattern, so it is never counted as a file.
      action: `Stage ${paths.length} path${paths.length === 1 ? "" : "s"}`,
      target: paths.join(", "),
      detail: `Adds the current content of ${paths.join(", ")} to what the next commit will include. A folder or pattern adds every file under it, apart from new files git ignores. Nothing is committed yet.`,
      command: `git add -- ${paths.join(" ")}`,
      access: "change",
      // Staging runs the repository's own filters with the account's full
      // access, so no grant covers it (ADR 0009).
      asksEachTime: true,
    };
  },
  async execute(git, root, args, signal, containment) {
    const paths = pathsArgument(args);
    if (!paths || !paths.every(isSafeArgument))
      return errorResult("Name one or more real paths to stage.");
    return invoke(git, root, ["add", "--", ...paths], signal, containment);
  },
};

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
  git: string,
  root: string,
  containment: GitContainment | undefined,
): Promise<readonly string[] | undefined> {
  const folder = await runGit(
    git,
    root,
    ["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
    undefined,
    containment,
  );
  const hooksFolder = folder.stdout.trim();
  if (folder.exitCode !== 0 || folder.ending || /^[\\/]{2}/.test(hooksFolder))
    return undefined;
  const configured = await readGit(
    git,
    root,
    ["config", "-z", "--get-regexp", "^hook\\..+\\.event$"],
    undefined,
    containment,
  );
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

const commitTool: GitToolDefinition = {
  spec: {
    name: "git_commit",
    description: "Commit everything currently staged, with the given message.",
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
  async inspect(root, args, git, containment) {
    const message = commitMessage(args);
    if (!message)
      return argumentsInspection("Give a non-empty commit message.");
    const staged = await readGit(
      git,
      root,
      ["diff", "--no-ext-diff", "--no-textconv", "--staged", "--stat"],
      undefined,
      containment,
    );
    const summary = staged.stdout.trim();
    const hooks = await hooksACommitRuns(git, root, containment);
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
            ? `Commits what is staged:\n${shortened(summary, 2_000)}`
            : "Nothing is staged. This commit would be empty and git will refuse it."
      }${running}`,
      command: `git commit -m "${message}"`,
      access: "change",
      // Committing runs the repository's own hooks with the account's full
      // access, so no grant covers it (ADR 0009).
      asksEachTime: true,
    };
  },
  async execute(git, root, args, signal, containment) {
    const message = commitMessage(args);
    if (!message) return errorResult("Give a non-empty commit message.");
    return invoke(git, root, ["commit", "-m", message], signal, containment);
  },
};

function stashAction(args: unknown): "save" | "pop" | "list" | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["action"]
      : undefined;
  return value === "save" || value === "pop" || value === "list"
    ? value
    : undefined;
}

function stashMessage(args: unknown): string | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["message"]
      : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const stashTool: GitToolDefinition = {
  spec: {
    name: "git_stash",
    description:
      "Save the working tree's uncommitted changes aside, restore them, or list what is stashed.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["save", "pop", "list"] },
        message: {
          type: "string",
          description: "A note for a saved stash. Only used with `save`.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  access: "change",
  async inspect(root, args, _git, _containment, top) {
    const action = stashAction(args);
    if (!action) return argumentsInspection("Choose one of: save, pop, list.");
    const message = stashMessage(args);
    const commands = {
      save: message ? `git stash push -m "${message}"` : "git stash push",
      pop: "git stash pop",
      list: "git stash list",
    } as const;
    const details = {
      // Git stashes and restores the whole repository's tracked changes,
      // whichever of its folders it runs in.
      save: `Sets aside the uncommitted changes to tracked files across the whole repository${top ? ` at ${top}` : ""}, and leaves new files where they are.`,
      pop: `Restores the most recently stashed changes across the whole repository${top ? ` at ${top}` : ""}, and removes them from the stash.`,
      list: undefined,
    } as const;
    return {
      ok: true,
      action:
        action === "save"
          ? "Stash uncommitted changes"
          : action === "pop"
            ? "Restore the last stash"
            : "List stashes",
      target: basename(root),
      command: commands[action],
      access: action === "list" ? "read" : "change",
      ...(details[action] ? { detail: details[action] } : {}),
      // Saving and restoring run the repository's own filters (ADR 0009).
      ...(action === "list" ? {} : { asksEachTime: true as const }),
    };
  },
  async execute(git, root, args, signal, containment) {
    const action = stashAction(args);
    if (!action) return errorResult("Choose one of: save, pop, list.");
    const message = stashMessage(args);
    const argv =
      action === "save"
        ? ["stash", "push", ...(message ? ["-m", message] : [])]
        : action === "pop"
          ? ["stash", "pop"]
          : ["stash", "list"];
    return invoke(git, root, argv, signal, containment, action === "list");
  },
};

function branchName(args: unknown): string | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["name"]
      : undefined;
  return typeof value === "string" ? value.trim() : undefined;
}

/**
 * Whether git takes `name` for a branch: never one read as an option, and
 * only one `git check-ref-format --branch` accepts as it is given. Git
 * expands a name such as `@{-1}` to the branch it means, which the approval
 * would not name, so such a name is refused, as is `@`.
 */
async function validBranch(
  git: string,
  root: string,
  name: string | undefined,
  containment: GitContainment | undefined,
): Promise<boolean> {
  // "@" alone is a branch git can make, but one it reads as the current
  // commit when switching.
  if (name === undefined || name === "@" || !isSafeArgument(name)) return false;
  const checked = await readGit(
    git,
    root,
    ["check-ref-format", "--branch", name],
    undefined,
    containment,
  );
  return (
    checked.exitCode === 0 &&
    !checked.ending &&
    checked.stdout.replace(/\r?\n$/, "") === name
  );
}

const branchRefusal =
  "Give a branch name git accepts: no spaces, no '..', not starting with '-' or ending in '.lock'.";

/** The tracked files with changes not yet committed, staged or not. */
async function uncommitted(
  git: string,
  root: string,
  signal: AbortSignal | undefined,
  containment: GitContainment | undefined,
): Promise<string | undefined> {
  const status = await readGit(
    git,
    root,
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=no",
      "--ignore-submodules=dirty",
    ],
    signal,
    containment,
  );
  if (status.exitCode !== 0 || status.ending) return "git could not say";
  const files = status.stdout.trim();
  return files ? files : undefined;
}

/**
 * Why switching to `name` would lose something of the person's, or nothing
 * when it would not. Git replaces what it does not track with the branch's
 * files without asking when it ignores it here, so each file the branch adds
 * is looked for in the work tree: the file itself, a folder holding files
 * git does not track, or a file or link where the branch has a folder.
 */
async function switchLoss(
  git: string,
  root: string,
  name: string,
  signal: AbortSignal | undefined,
  containment: GitContainment | undefined,
): Promise<string | undefined> {
  const read = (args: readonly string[]) =>
    readGit(git, root, args, signal, containment);
  const branch = `refs/heads/${name}`;
  const exists = await read(["rev-parse", "--verify", "--quiet", branch]);
  if (exists.ending) return endings[exists.ending];
  if (exists.exitCode !== 0) return `There is no local branch named ${name}.`;
  const cannotSay =
    "git could not say which files the switch would replace, so the branch was not switched.";
  const top = await read(["rev-parse", "--show-toplevel"]);
  const head = await read(["rev-parse", "--verify", "--quiet", "HEAD"]);
  const folder = top.stdout.replace(/\r?\n$/, "");
  if (top.exitCode !== 0 || top.ending || !folder || head.ending)
    return cannotSay;
  // Paths from the repository's top, whatever its diff settings say. With no
  // commit yet, every file the branch has is one it adds.
  const added = await read(
    head.exitCode === 0
      ? [
          "diff",
          "--name-only",
          "-z",
          "--no-relative",
          "--no-renames",
          "--diff-filter=A",
          "HEAD",
          branch,
          "--",
        ]
      : ["ls-tree", "-r", "-z", "--name-only", "--full-tree", branch],
  );
  if (added.exitCode !== 0 || added.ending) return cannotSay;

  const kinds = new Map<string, Promise<"missing" | "folder" | "other">>();
  const kindOf = (path: string) => {
    let kind = kinds.get(path);
    if (!kind) {
      kind = lstat(join(folder, path)).then(
        (found) =>
          found.isDirectory() && !found.isSymbolicLink() ? "folder" : "other",
        (error: NodeJS.ErrnoException) =>
          error.code === "ENOENT" || error.code === "ENOTDIR"
            ? "missing"
            : "other",
      );
      kinds.set(path, kind);
    }
    return kind;
  };
  /** Whether a folder holds anything git does not track, ignored or not. */
  const holdsUntracked = async (path: string) => {
    const listed = await read([
      "ls-files",
      "-z",
      "--others",
      "--directory",
      "--",
      `:(top,literal)${path}`,
    ]);
    return listed.exitCode !== 0 || !!listed.ending || listed.stdout !== "";
  };

  const present = new Set<string>();
  for (const path of added.stdout.split("\0").filter(Boolean)) {
    const parts = path.split("/");
    let blocked: string | undefined;
    let reached = true;
    for (let depth = 1; depth < parts.length; depth += 1) {
      const parent = parts.slice(0, depth).join("/");
      const kind = await kindOf(parent);
      if (kind === "folder") continue;
      if (kind === "other") blocked = parent;
      reached = false;
      break;
    }
    if (blocked) present.add(blocked);
    if (!reached) continue;
    const kind = await kindOf(path);
    if (kind === "other" || (kind === "folder" && (await holdsUntracked(path))))
      present.add(path);
  }
  return present.size
    ? `Switching to ${name} would replace files here that git does not track but that branch does, so the branch was not switched: move them or commit them first.\n${shortened([...present].join("\n"), 1_000)}`
    : undefined;
}

const switchRefusal = (files: string) =>
  `The repository has uncommitted changes, so the branch was not switched: commit or stash them first.\n${shortened(files, 1_000)}`;

const createBranchTool: GitToolDefinition = {
  spec: {
    name: "git_create_branch",
    description:
      "Create a branch at the current commit, without switching to it. Use git_switch_branch to work on it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The new branch's name." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  access: "change",
  async inspect(root, args, git, containment) {
    const name = branchName(args);
    if (!(await validBranch(git, root, name, containment)))
      return argumentsInspection(branchRefusal, "name");
    return {
      ok: true,
      action: `Create branch ${name}`,
      target: basename(root),
      command: `git branch ${name}`,
      access: "change",
      // Git runs the repository's reference hook as it creates it (ADR 0009).
      asksEachTime: true,
    };
  },
  async execute(git, root, args, signal, containment) {
    const name = branchName(args);
    if (!(await validBranch(git, root, name, containment)))
      return errorResult(branchRefusal);
    return invoke(git, root, ["branch", name!], signal, containment);
  },
};

const switchBranchTool: GitToolDefinition = {
  spec: {
    name: "git_switch_branch",
    description:
      "Switch the repository to another local branch. Refused while there are uncommitted changes to tracked files.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The local branch to switch to." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  access: "change",
  async inspect(root, args, git, containment, top) {
    const name = branchName(args);
    if (!(await validBranch(git, root, name, containment)))
      return argumentsInspection(branchRefusal, "name");
    const changes = await uncommitted(git, root, undefined, containment);
    if (changes) return { ok: false, reason: switchRefusal(changes) };
    const loss = await switchLoss(git, root, name!, undefined, containment);
    if (loss) return { ok: false, reason: loss };
    return {
      ok: true,
      action: `Switch to branch ${name}`,
      target: basename(root),
      command: `git switch ${name}`,
      access: "change",
      // A switch replaces the whole repository's tracked files, whichever of
      // its folders it runs in.
      detail: `Replaces the tracked files across the whole repository${top ? ` at ${top}` : ""} with the branch's.`,
      // Switching runs the repository's filters and checkout hook (ADR 0009).
      asksEachTime: true,
    };
  },
  async execute(git, root, args, signal, containment) {
    const name = branchName(args);
    if (!(await validBranch(git, root, name, containment)))
      return errorResult(branchRefusal);
    // Changes made since the switch was approved would be carried over or
    // lost, so they are refused here too.
    const changes = await uncommitted(git, root, signal, containment);
    if (changes) return errorResult(switchRefusal(changes));
    const loss = await switchLoss(git, root, name!, signal, containment);
    if (loss) return errorResult(loss);
    // Only a local branch: git would otherwise make one from a remote's.
    return invoke(
      git,
      root,
      ["switch", "--no-guess", name!],
      signal,
      containment,
    );
  },
};

export const gitTools: readonly GitToolDefinition[] = [
  statusTool,
  diffTool,
  logTool,
  showTool,
  branchTool,
  stageTool,
  commitTool,
  stashTool,
  createBranchTool,
  switchBranchTool,
];

export function describeGitResult(
  name: string,
  result: ToolInvocationResult,
): readonly ActionDetail[] {
  if (!result.ok) return [];
  const value = result.value;
  if (
    typeof value !== "object" ||
    value === null ||
    !("content" in value) ||
    !Array.isArray((value as { content: unknown }).content)
  )
    return [];
  const text = (value as { content: readonly { text?: string }[] }).content
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
  return text ? [{ kind: "text", label: name, text }] : [];
}
