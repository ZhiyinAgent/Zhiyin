/** What more than one part of a turn shares: limits, small types and helpers. */

import type { WorkspaceContext, WorkspaceDescription } from "@zhiyin/contract";
import type {
  ModelClientErrorCode,
  ModelMessage,
  ModelToolCall,
} from "@zhiyin/model-client";

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
  return { id: call.callId, name: call.name, arguments: call.arguments };
}

/**
 * The calls of one round that can be answered. One streamed without an id is
 * given one, so its result still pairs with it; one without a name cannot be
 * answered at all, and is only counted.
 */
export function answerableCalls(
  calls: readonly AssembledToolCall[],
  newId: () => string,
): { readonly answerable: AssembledToolCall[]; readonly nameless: number } {
  const answerable = calls.filter((call) => call.name);
  for (const call of answerable) if (!call.callId) call.callId = newId();
  return { answerable, nameless: calls.length - answerable.length };
}

/** Ends a round that held a call nobody could answer, once the rest ran. */
export const namelessCallFailure =
  "The model returned an incomplete tool request. Try the task again.";

/**
 * Brings the request's record of `call` in line with the arguments it ended
 * up with, so the model is left holding what actually ran rather than the
 * draft it first wrote.
 */
export function rewriteCallArguments(
  messages: ModelMessage[],
  call: AssembledToolCall,
): void {
  for (const [index, message] of messages.entries()) {
    if (message.role !== "assistant" || !message.toolCalls) continue;
    if (
      !message.toolCalls.some(
        (item) => item.id === call.callId && item.arguments !== call.arguments,
      )
    )
      continue;
    messages[index] = {
      ...message,
      toolCalls: message.toolCalls.map((item) =>
        item.id === call.callId ? { ...item, arguments: call.arguments } : item,
      ),
    };
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
