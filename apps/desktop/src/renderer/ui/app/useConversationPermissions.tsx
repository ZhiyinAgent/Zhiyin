import { useState } from "react";
import type { WorkspaceTask } from "./workspaceState.js";
import { ConversationPermissions } from "./ConversationPermissions.js";

/**
 * A conversation's Permissions dialog. One only listed is opened first by the
 * core, which reads it without going to it; the dialog follows once it is
 * open. A wait the core has answered without it, or that the person left by
 * going to another conversation, ends there: the dialog never appears later
 * unasked.
 */
export function useConversationPermissions(
  tasks: readonly WorkspaceTask[],
  selectedTaskId: string | null,
  revoke: (taskId: string, permissionId: string) => Promise<void>,
  load: (taskId: string) => Promise<void>,
) {
  const [asked, setAsked] = useState<{
    taskId: string;
    /** Set while the conversation is being opened. */
    waiting?: { from: string | null; answered: boolean };
  }>();
  const task = asked && tasks.find((item) => item.id === asked.taskId);
  if (asked && !task) {
    const waiting = asked.waiting;
    const left =
      !waiting || waiting.answered || selectedTaskId !== waiting.from;
    if (left) setAsked(undefined);
  }

  function open(taskId: string) {
    if (tasks.some((item) => item.id === taskId)) {
      setAsked({ taskId });
      return;
    }
    const waiting = { from: selectedTaskId, answered: false };
    setAsked({ taskId, waiting });
    void load(taskId).finally(() =>
      setAsked((current) =>
        current?.waiting === waiting
          ? { taskId, waiting: { ...waiting, answered: true } }
          : current,
      ),
    );
  }

  const panel = task ? (
    <ConversationPermissions
      task={task}
      onClose={() => setAsked(undefined)}
      onRevoke={(permissionId) => revoke(task.id, permissionId)}
    />
  ) : null;
  return { open, panel };
}
