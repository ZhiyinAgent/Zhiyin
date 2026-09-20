import { basename } from "node:path";
import type {
  ActionDetail,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import type { GitContainment } from "./run-git.js";
import { runGit } from "./run-git.js";

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

async function invoke(
  git: string,
  root: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
  containment: GitContainment | undefined,
): Promise<GitToolResult> {
  const { exitCode, stdout, stderr } = await runGit(
    git,
    root,
    args,
    signal,
    containment,
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

function argumentsInspection(reason: string): ToolCallInspection {
  return { ok: false, correctable: true, reason };
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
    return invoke(
      git,
      root,
      ["status", "--porcelain=v1", "-b"],
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
    return invoke(
      git,
      root,
      ["diff", ...(staged ? ["--staged"] : [])],
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
      return argumentsInspection("Name a real commit, branch, or tag to show.");
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
    return invoke(git, root, ["show", ref], signal, containment);
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
    return invoke(git, root, ["branch", "--list"], signal, containment);
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
      return argumentsInspection("Name one or more real paths to stage.");
    return {
      ok: true,
      action: `Stage ${paths.length} file${paths.length === 1 ? "" : "s"}`,
      target: paths.join(", "),
      detail: `Adds the current content of ${paths.join(", ")} to what the next commit will include. Nothing is committed yet.`,
      command: `git add -- ${paths.join(" ")}`,
      access: "change",
    };
  },
  async execute(git, root, args, signal, containment) {
    const paths = pathsArgument(args);
    if (!paths || !paths.every(isSafeArgument))
      return errorResult("Name one or more real paths to stage.");
    return invoke(git, root, ["add", "--", ...paths], signal, containment);
  },
};

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
    const staged = await runGit(
      git,
      root,
      ["diff", "--staged", "--stat"],
      undefined,
      containment,
    );
    const summary = staged.stdout.trim();
    return {
      ok: true,
      action: "Commit the staged changes",
      target: basename(root),
      detail: summary
        ? `Commits exactly what is staged:\n${shortened(summary, 2_000)}`
        : "Nothing is staged. This commit would be empty and git will refuse it.",
      command: `git commit -m "${message}"`,
      access: "change",
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
  async inspect(root, args) {
    const action = stashAction(args);
    if (!action) return argumentsInspection("Choose one of: save, pop, list.");
    const message = stashMessage(args);
    const commands = {
      save: message ? `git stash push -m "${message}"` : "git stash push",
      pop: "git stash pop",
      list: "git stash list",
    } as const;
    const details = {
      save: "Sets aside every uncommitted change in the workspace, leaving the working tree clean.",
      pop: "Restores the most recently stashed changes and removes them from the stash.",
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
    return invoke(git, root, argv, signal, containment);
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
