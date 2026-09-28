import type { ModelHistory } from "./model-history.js";
import type { PlanProgress } from "./plan-progress.js";
import type { AssembledToolCall } from "./turn-shared.js";
import { toolOutput } from "./notices.js";
import { skippedAfterDecline } from "./refusals.js";

/** Accounts for a later call without inspecting or executing it. */
export async function answerDeclinedCall(
  taskId: string,
  call: AssembledToolCall,
  plan: PlanProgress,
  history: ModelHistory,
): Promise<void> {
  const sent = JSON.stringify(skippedAfterDecline());
  plan.answered(taskId, call.callId, sent);
  await history.result(call, toolOutput(call.name, sent), false);
}
