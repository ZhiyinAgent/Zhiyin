import type { WorkspaceDescription } from "@zhiyin/contract";
import { harnessNotice } from "../turn/notices.js";
import { workspaceEntries } from "../turn/turn-shared.js";
import type { ModelHistory } from "./model-history.js";

/**
 * Tells the model the workspace's top-level entries as the turn found them,
 * unless the last it was told is the same, so they cost the conversation a
 * notice only when they change and the start of its requests never does.
 */
export async function noteWorkspace(
  history: ModelHistory,
  workspace: WorkspaceDescription,
): Promise<void> {
  const text = workspaceEntries(workspace);
  if (history.latestNotice("workspace") === harnessNotice("workspace", text))
    return;
  await history.notice("workspace", text);
}
