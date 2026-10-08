import type { ModelHistory } from "../context/model-history.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import { toolOutput } from "../turn/notices.js";
import { skippedAfterDecline } from "./refusals.js";

/** Accounts for a later call without inspecting or executing it. */
export async function answerDeclinedCall(
  call: AssembledToolCall,
  history: ModelHistory,
): Promise<void> {
  const sent = JSON.stringify(skippedAfterDecline());
  await history.result(call, toolOutput(call.name, sent), false);
}
