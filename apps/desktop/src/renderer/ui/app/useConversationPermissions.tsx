import { useState } from "react";
import type { WorkspaceTask } from "./workspaceState.js";
import { ConversationPermissions } from "./ConversationPermissions.js";

export function useConversationPermissions(
  tasks: readonly WorkspaceTask[],
  revoke: (taskId: string, permissionId: string) => Promise<void>,
) {
  const [taskId, open] = useState<string>();
  const task = tasks.find((item) => item.id === taskId);
  const panel = task ? (
    <ConversationPermissions
      task={task}
      onClose={() => open(undefined)}
      onRevoke={(permissionId) => revoke(task.id, permissionId)}
    />
  ) : null;
  return { open, panel };
}
