import { useState } from "react";
import type { ContextBudgetChoice, CoreApi } from "@zhiyin/contract";
import type { WorkspaceState, WorkspaceTask } from "./workspaceState.js";

/**
 * The budget the composer's ring shows and changes: the conversation's own,
 * else the app's default, else Medium. A choice made before the first message
 * belongs to no conversation yet, so it is held here and given to the one that
 * message starts, before the message is sent.
 */
export function useContextBudget(
  state: WorkspaceState,
  selectedTask: WorkspaceTask | null,
  setContextBudget: CoreApi["setContextBudget"],
  condenseNow: CoreApi["condenseNow"],
) {
  const [pending, setPending] = useState<ContextBudgetChoice>();
  // A choice for a conversation not yet started is left behind with it.
  const [shownFor, setShownFor] = useState(selectedTask?.id);
  if (shownFor !== selectedTask?.id) {
    setShownFor(selectedTask?.id);
    setPending(undefined);
  }

  const budget =
    (selectedTask ? selectedTask.contextBudget : pending) ??
    state.contextBudget ??
    "medium";
  return {
    context: {
      ...(selectedTask?.contextUsage
        ? { usage: selectedTask.contextUsage }
        : {}),
      model: state.provider,
      budget,
      onChoose: (choice: ContextBudgetChoice) => {
        if (selectedTask) void setContextBudget(selectedTask.id, choice);
        else setPending(choice);
      },
      ...(selectedTask
        ? { onCondense: () => condenseNow(selectedTask.id) }
        : {}),
    },
    /** Gives a conversation just started the budget chosen before it. */
    adopt: async (taskId: string) => {
      if (!selectedTask && pending) await setContextBudget(taskId, pending);
    },
  };
}
