/**
 * A turn's files (ADR 0031): from its start, each file of the conversation's
 * folder, and of each folder outside it the conversation was granted for
 * changes, is kept as the turn found it, saved when the turn first writes it;
 * once it ends, the person's own writes go through unsaved. A message the
 * person adds while the turn runs begins it again, so going back to any
 * message puts back each file as that message found it.
 */

import type { ConversationPermission } from "@zhiyin/contract";
import type { AgentLoopDependencies } from "../dependencies.js";

type TurnFileDependencies = Pick<
  AgentLoopDependencies,
  "turnFiles" | "workspace" | "recordDefect"
>;

/**
 * Begins the turn of `taskId` for recovery, over its workspace and each
 * folder outside it `granted` names for changes, or begins it again from
 * now. Answers whether there is a turn to end.
 */
async function beginTurnFiles(
  deps: TurnFileDependencies,
  taskId: string,
  granted: readonly ConversationPermission[],
): Promise<boolean> {
  const files = deps.turnFiles;
  const root = deps.workspace.workspaceRoot(taskId);
  if (!files || !root) return false;
  const outside = granted.flatMap((grant) =>
    grant.kind === "outside-folder" && grant.folder ? [grant.folder] : [],
  );
  await files
    .beginTurn(taskId, [root, ...outside])
    .catch((error: unknown) => deps.recordDefect?.({ taskId, error }));
  return true;
}

/**
 * Runs `work` as a turn of `taskId` for recovery, over the folders `granted`
 * names as it begins. `work` is handed what begins the turn again, over the
 * folders granted by then. A turn whose files could not be watched still
 * runs: each run in it is backed up as it is readied.
 */
export async function withTurnFiles<T>(
  deps: TurnFileDependencies,
  taskId: string,
  granted: () => readonly ConversationPermission[],
  work: (renew: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const files = deps.turnFiles;
  const nothing = async () => {};
  if (!files || !(await beginTurnFiles(deps, taskId, granted())))
    return work(nothing);
  try {
    return await work(async () => {
      await beginTurnFiles(deps, taskId, granted());
    });
  } finally {
    await files
      .endTurn(taskId)
      .catch((error: unknown) => deps.recordDefect?.({ taskId, error }));
  }
}
