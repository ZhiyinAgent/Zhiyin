/** What more than one part of a turn shares: limits, small types and helpers. */

import {
  VisibleError,
  type ToolSpec,
  type TurnRemedy,
  type WorkspaceContext,
  type WorkspaceDescription,
} from "@zhiyin/contract";
import type {
  ModelClientErrorCode,
  ModelToolCall,
  TokenLimitDetail,
} from "@zhiyin/model-client";

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
  /** What was corrected in the call before its input was read, in words. */
  readonly corrections?: readonly string[];
};

/**
 * The tools on offer as a round's calls are answered, each as its own spec,
 * read at each call: opening a toolkit changes them.
 */
export type RoundTools = { readonly tools: readonly ToolSpec[] };

export type PresentedAction = {
  readonly title: string;
  readonly description: string;
  /** The description is a model's account, not the code's. */
  readonly byModel?: true;
};

/**
 * The counts a refusal as too long carried, empty when it carried none;
 * nothing when the failure was anything else.
 */
export function refusedAsTooLong(error: unknown): TokenLimitDetail | undefined {
  if (modelFailure(error)?.code !== "contextExceeded") return undefined;
  const tokens = (error as { readonly tokens?: TokenLimitDetail }).tokens;
  return tokens ?? {};
}

/** A failure the loop itself ends a turn with, and what to do about it. */
export class TurnFailure extends VisibleError {
  readonly remedies: readonly TurnRemedy[];
  constructor(message: string, remedies: readonly TurnRemedy[]) {
    super(message);
    this.remedies = remedies;
  }
}

export const noLongerFits =
  "This conversation no longer fits the selected model, even after condensing it.";

/**
 * A model client failure, recognised by what it carries rather than by its
 * class: the loop holds the client's interface, never its implementation.
 */
export function modelFailure(error: unknown):
  | {
      readonly message: string;
      readonly code: ModelClientErrorCode;
      readonly retryable?: boolean;
    }
  | undefined {
  return error instanceof Error &&
    error.name === "ModelClientError" &&
    "code" in error &&
    typeof error.code === "string"
    ? (error as Error & {
        readonly code: ModelClientErrorCode;
        readonly retryable?: boolean;
      })
    : undefined;
}

/**
 * The conversation's folder as the turn will describe it to the model. A folder that cannot be
 * read is an empty one here: a turn still runs, and the tools report what they
 * meet when they are actually used.
 */
export async function describedWorkspace(
  workspace: WorkspaceContext,
  taskId: string,
): Promise<WorkspaceDescription> {
  try {
    return await workspace.describeWorkspace(taskId);
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

export const auxiliarySystemMessage =
  "You write restrained interface copy and evaluate only the supplied evidence. Return only the requested JSON. Do not infer missing facts. Answer immediately: do not deliberate at length, and do not think through alternatives before replying. These are short presentational answers, not problems to solve.";

/** The workspace's top-level entries, one line each. */
export function workspaceEntries(workspace: WorkspaceDescription): string {
  const entries = workspace.entries.length
    ? workspace.entries
        .map((entry) => `- ${entry.kind}: ${entry.path}`)
        .join("\n")
    : "- No entries were available.";
  return [
    "Top-level entries:",
    entries,
    ...(workspace.truncated ? ["- The inventory was truncated."] : []),
  ].join("\n");
}
