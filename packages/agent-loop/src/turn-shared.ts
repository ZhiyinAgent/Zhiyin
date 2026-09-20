/** What more than one part of a turn shares: limits, small types and helpers. */

import type { WorkspaceContext, WorkspaceDescription } from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { ModelClientErrorCode, ModelToolCall } from "@zhiyin/model-client";

/**
 * How many times in a row the model may ask for tools before the person
 * chooses whether to renew the budget or pause with a progress report.
 *
 * This is a runaway guard, not a work budget, and eight was tight enough to be
 * both: a piece of analysis that looks around, reads a file, runs something,
 * writes a result and draws four charts spends most of them on ordinary work
 * and stops mid-task. Cost, time, and token budgets remain separate work in
 * ADR 0038.
 */
export const maximumToolRounds = 24;

export const pauseReportInstruction = [
  "The person chose to pause at the renewable work-budget boundary.",
  "Give one concise progress report now: what is complete, the current state, what remains, any blockers, and the safest next step.",
  "Do not call tools or continue the work. End after this report.",
  "A tool call proposed immediately before the pause was not run, so do not describe it as completed.",
].join("\n");

/** Quiet corrections one tool may take per turn before the person sees it. */
export const maximumQuietRetries = 3;

export type AssembledToolCall = {
  readonly index: number;
  callId: string;
  name: string;
  arguments: string;
};

export type PresentedAction = {
  readonly title: string;
  readonly description: string;
  readonly planItemId?: string;
};

/**
 * A model client failure, recognised by what it carries rather than by its
 * class: the loop holds the client's interface, never its implementation.
 */
export function modelFailure(
  error: unknown,
):
  | { readonly message: string; readonly code: ModelClientErrorCode }
  | undefined {
  return error instanceof Error &&
    error.name === "ModelClientError" &&
    "code" in error &&
    typeof error.code === "string"
    ? (error as Error & { readonly code: ModelClientErrorCode })
    : undefined;
}

/**
 * The folder as the turn will describe it to the model. A folder that cannot be
 * read is an empty one here: a turn still runs, and the tools report what they
 * meet when they are actually used.
 */
export async function describedWorkspace(
  workspace: WorkspaceContext,
): Promise<WorkspaceDescription> {
  try {
    return await workspace.describeWorkspace();
  } catch {
    return { rootName: "workspace", entries: [], truncated: false };
  }
}

/** One assembled call as the provider's protocol carries it. */
export function protocolCall(call: AssembledToolCall): ModelToolCall {
  if (!call.callId || !call.name) {
    throw new VisibleError(
      "The model returned an incomplete tool request. Try the task again.",
    );
  }
  return { id: call.callId, name: call.name, arguments: call.arguments };
}

/** A call's arguments, or a failure the person can read. */
export function parsedArguments(call: AssembledToolCall): unknown {
  try {
    const parsed: unknown = JSON.parse(call.arguments);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be an object.");
    }
    return parsed;
  } catch {
    throw new VisibleError(
      "The model returned invalid input for a requested action.",
    );
  }
}

export const auxiliarySystemMessage =
  "You write restrained interface copy and evaluate only the supplied evidence. Return only the requested JSON. Do not infer missing facts. Answer immediately: do not deliberate at length, and do not think through alternatives before replying. These are short presentational answers, not problems to solve.";

export function workspaceInventory(workspace: WorkspaceDescription): string {
  const entries = workspace.entries.length
    ? workspace.entries
        .map((entry) => `- ${entry.kind}: ${entry.path}`)
        .join("\n")
    : "- No entries were available.";
  return [
    `Current workspace: ${workspace.rootName}`,
    "Top-level entries:",
    entries,
    ...(workspace.truncated ? ["- The inventory was truncated."] : []),
  ].join("\n");
}
