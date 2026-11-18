/**
 * Branches: listing them, creating one, and switching to one only when nothing
 * of the person's would be carried over or replaced.
 */

import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import { endings } from "./run-git.js";
import {
  argumentsInspection,
  changeOutput,
  commandLine,
  errorResult,
  isSafeArgument,
  readAnswer,
  textResult,
  type CheckedCall,
  type GitCall,
  type GitToolDefinition,
} from "./git-tool.js";
import {
  commitAt,
  currentBranch,
  reader,
  standing,
} from "./resulting-state.js";

export const branchTool: GitToolDefinition = {
  spec: {
    name: "git_branch",
    label: "List branches",
    description: "List local branches and show which one is checked out.",
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
      action: "List branches",
      target: basename(root),
      command: "git branch",
      access: "read",
    };
  },
  async execute(call) {
    return readAnswer(call, ["branch", "--list"]);
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
  call: GitCall,
  name: string | undefined,
): Promise<boolean> {
  // "@" alone is a branch git can make, but one it reads as the current
  // commit when switching.
  if (name === undefined || name === "@" || !isSafeArgument(name)) return false;
  const checked = await call.read(["check-ref-format", "--branch", name]);
  return (
    checked.exitCode === 0 &&
    !checked.ending &&
    checked.stdout.replace(/\r?\n$/, "") === name
  );
}

const branchRefusal =
  "Give a branch name git accepts: no spaces, no '..', not starting with '-' or ending in '.lock'.";

/** The tracked files with changes not yet committed, staged or not. */
async function uncommitted(call: GitCall): Promise<string | undefined> {
  const status = await call.read(
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=no",
      "--ignore-submodules=dirty",
    ],
    call.signal,
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
  call: CheckedCall,
  name: string,
): Promise<string | undefined> {
  const read = (args: readonly string[]) => call.read(args, call.signal);
  const branch = `refs/heads/${name}`;
  const exists = await read(["rev-parse", "--verify", "--quiet", branch]);
  if (exists.ending) return endings[exists.ending];
  if (exists.exitCode !== 0) return `There is no local branch named ${name}.`;
  const cannotSay =
    "git could not say which files the switch would replace, so the branch was not switched.";
  const folder = call.top;
  const head = await read(["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.ending) return cannotSay;
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
    ? `Switching to ${name} would replace files here that git does not track but that branch does, so the branch was not switched: move them or commit them first.\n${[...present].join("\n")}`
    : undefined;
}

const switchRefusal = (files: string) =>
  `The repository has uncommitted changes, so the branch was not switched: commit or stash them first.\n${files.trim()}`;

export const createBranchTool: GitToolDefinition = {
  spec: {
    name: "git_create_branch",
    label: "Create a branch",
    description:
      "Create a branch at the current commit, without switching to it. Use git_switch_branch to work on it. The answer gives the commit the branch is at and the branch still checked out.",
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
  async inspect(call, args) {
    const { root } = call;
    const name = branchName(args);
    if (!name || !(await validBranch(call, name)))
      return argumentsInspection(branchRefusal);
    return {
      ok: true,
      action: `Create branch ${name}`,
      target: basename(root),
      command: commandLine(["branch", name]),
      access: "change",
      // Git runs the repository's reference hook as it creates it (ADR 0012).
      asksEachTime: true,
    };
  },
  async execute(call, args) {
    const name = branchName(args);
    if (!(await validBranch(call, name))) return errorResult(branchRefusal);
    const ran = await changeOutput(call, ["branch", name!]);
    if ("failed" in ran) return ran.failed;
    const read = reader(call);
    const at = await commitAt(read, `refs/heads/${name!}`);
    if (!at)
      return errorResult(
        `git answered, but there is no branch ${name!} to be found.`,
      );
    return textResult(
      `${ran.text}\nCreated branch ${name!} at ${at}. Still on ${(await currentBranch(read)) ?? "no branch"}: git_switch_branch moves to it.`.trim(),
    );
  },
};

export const switchBranchTool: GitToolDefinition = {
  spec: {
    name: "git_switch_branch",
    label: "Switch branches",
    description:
      "Switch the repository to another local branch. Refused while there are uncommitted changes to tracked files. The answer gives the branch and commit it is on after, and what is left uncommitted.",
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
  async inspect(call, args) {
    const { root, top } = call;
    const name = branchName(args);
    if (!(await validBranch(call, name)))
      return argumentsInspection(branchRefusal);
    const changes = await uncommitted(call);
    if (changes) return { ok: false, reason: switchRefusal(changes) };
    const loss = await switchLoss(call, name!);
    if (loss) return { ok: false, reason: loss };
    return {
      ok: true,
      action: `Switch to branch ${name}`,
      target: basename(root),
      command: commandLine(["switch", name!]),
      access: "change",
      // A switch replaces the whole repository's tracked files, whichever of
      // its folders it runs in.
      detail: `Replaces the tracked files across the whole repository at ${top} with the branch's.`,
      // Switching runs the repository's filters and checkout hook (ADR 0012).
      asksEachTime: true,
    };
  },
  async execute(call, args) {
    const name = branchName(args);
    if (!(await validBranch(call, name))) return errorResult(branchRefusal);
    // Changes made since the switch was approved would be carried over or
    // lost, so they are refused here too.
    const changes = await uncommitted(call);
    if (changes) return errorResult(switchRefusal(changes));
    const loss = await switchLoss(call, name!);
    if (loss) return errorResult(loss);
    // Only a local branch: git would otherwise make one from a remote's.
    const ran = await changeOutput(call, ["switch", "--no-guess", name!]);
    if ("failed" in ran) return ran.failed;
    const now = await standing(reader(call));
    if (now.branch !== name)
      return errorResult(
        `git answered, but the repository is on ${now.branch ?? "no branch"}, not ${name!}.`,
      );
    return textResult(`${ran.text}\n${now.said}`.trim());
  },
};
