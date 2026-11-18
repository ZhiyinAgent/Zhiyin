/**
 * What a git tool is, and how one runs git and answers: each argument list run
 * as git receives it, git's output whole, for the conversation to size as it
 * sizes any answer, and a refusal of arguments the model can correct.
 */

import type { ToolCallInspection } from "@zhiyin/contract";
import type { GitContainment, GitInvocation, GitRead } from "./run-git.js";
import { endings, gitReads, runGit } from "./run-git.js";

export type GitToolSpec = {
  readonly name: string;
  /** What the person reads while a call to it is written. */
  readonly label: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
};

export type GitToolResult = {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
};

/** One tool call's git: the folder it runs in, and how it reads and changes. */
export type GitCall = {
  readonly git: string;
  readonly root: string;
  readonly signal: AbortSignal | undefined;
  readonly containment: GitContainment | undefined;
  /**
   * A read, starting no program the repository brings, stopped only by the
   * signal it is given. The reads of one call share one look at the
   * repository's settings until a change runs.
   */
  read(args: readonly string[], signal?: AbortSignal): Promise<GitInvocation>;
  /**
   * A change, run as git runs it for the person. It can change the settings
   * reads turn programs off by, so reads after it look at them again.
   */
  change(args: readonly string[]): Promise<GitInvocation>;
};

/** A call in a repository the check found git acts on as it should. */
export type CheckedCall = GitCall & {
  /** The work tree git acts on. */
  readonly top: string;
};

export function gitCall(
  git: string,
  root: string,
  signal: AbortSignal | undefined,
  containment: GitContainment | undefined,
): GitCall {
  let reads: GitRead = gitReads(git, root, containment);
  return {
    git,
    root,
    signal,
    containment,
    read: (args, readSignal) => reads(args, readSignal),
    async change(args) {
      const ran = await runGit(git, root, args, signal, containment);
      reads = gitReads(git, root, containment);
      return ran;
    },
  };
}

/**
 * A git call as its tool inspects it, with whether this call only reads, from
 * which the connection works out its effects.
 */
type GitInspection =
  | Extract<ToolCallInspection, { readonly ok: false }>
  | (Extract<ToolCallInspection, { readonly ok: true }> & {
      readonly access: "read" | "change";
    });

export type GitToolDefinition = {
  readonly spec: GitToolSpec;
  readonly access: "read" | "change";
  /** Asked with no signal: an approval is not stopped. */
  inspect(call: CheckedCall, args: unknown): Promise<GitInspection>;
  execute(call: CheckedCall, args: unknown): Promise<GitToolResult>;
};

export function textResult(text: string): GitToolResult {
  return { content: [{ type: "text", text: text || "(no output)" }] };
}

export function errorResult(text: string): GitToolResult {
  return {
    content: [{ type: "text", text: text || "git reported an error." }],
    isError: true,
  };
}

/** A read's answer: what git printed, or why it failed. */
export async function readAnswer(
  call: GitCall,
  args: readonly string[],
): Promise<GitToolResult> {
  const ran = await call.read(args, call.signal);
  return failureOf(ran) ?? textResult(ran.stdout.trim());
}

/**
 * What a change printed, run as git runs it for the person, or the answer
 * when git failed or did not finish it.
 */
export async function changeOutput(
  call: GitCall,
  args: readonly string[],
): Promise<{ readonly text: string } | { readonly failed: GitToolResult }> {
  const ran = await call.change(args);
  const failed = failureOf(ran);
  return failed ? { failed } : { text: ran.stdout.trim() };
}

/** What a read printed, or the answer when git failed or did not finish it. */
export async function readOutput(
  call: GitCall,
  args: readonly string[],
): Promise<{ readonly text: string } | { readonly failed: GitToolResult }> {
  const ran = await call.read(args, call.signal);
  const failed = failureOf(ran);
  return failed ? { failed } : { text: ran.stdout };
}

function failureOf({
  exitCode,
  stdout,
  stderr,
  ending,
}: GitInvocation): GitToolResult | undefined {
  // Ended by Zhiyin, not by git: said as such, with whatever git printed.
  if (ending)
    return errorResult(
      [endings[ending], (stderr || stdout).trim()].filter(Boolean).join("\n"),
    );
  if (exitCode !== 0) return errorResult((stderr || stdout).trim());
  return undefined;
}

/** The input that narrows a read to some files or folders. */
export const pathsProperty = {
  type: "array",
  items: { type: "string", minLength: 1 },
  maxItems: 100,
  description:
    "Workspace-relative files or folders to narrow to, at most 100. Leave out for the whole repository.",
} as const;

/**
 * The paths a read is narrowed to: none when none are given, or undefined
 * when one is not a path that is safe to give git.
 */
export function pathsAsked(args: unknown): readonly string[] | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["paths"]
      : undefined;
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > pathsProperty.maxItems ||
    !value.every((one) => typeof one === "string" && isSafeArgument(one))
  )
    return undefined;
  return value as string[];
}

/** The part of an argument list that narrows git to the paths given. */
export function narrowedTo(paths: readonly string[]): readonly string[] {
  return paths.length ? ["--", ...paths] : [];
}

/** The refusal of a read's paths. */
export const pathsRefused =
  "Name the paths as a list of workspace-relative files or folders, none starting with -, at most 100.";

/**
 * A ref, path, or similar user-influenced argument never starts with `-`:
 * that would let it be read as a git option instead of the value it is
 * supposed to be, the same risk `git <command> -- <path>` guards against.
 */
export function isSafeArgument(value: string): boolean {
  return value.length > 0 && !value.startsWith("-");
}

/**
 * A git call as the person reads it: each argument as git receives it, one
 * with a space, a quote or nothing in it written in double quotes, so the
 * line splits where git's arguments do. A message keeps its own line breaks.
 */
export function commandLine(argv: readonly string[]): string {
  return ["git", ...argv]
    .map((part) =>
      /^[^\s"\\]+$/.test(part)
        ? part
        : `"${part.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    )
    .join(" ");
}

/** A refusal of a call's arguments, which the model can correct. */
export function argumentsInspection(
  reason: string,
): Extract<ToolCallInspection, { readonly ok: false }> {
  return { ok: false, correctable: true, reason };
}
