import { useState } from "react";
import type { ContextBudgetChoice, CoreApi } from "@zhiyin/contract";
import type { WorkspaceState, WorkspaceTask } from "./workspaceState.js";

/**
 * The budget the composer's ring shows and changes: the conversation's own,
 * else the app's default, else Medium. Chosen for an open conversation, it is
 * that conversation's alone. Chosen before the first message, it becomes the
 * default for new conversations, shown at once rather than when the core
 * confirms it, and put back if it cannot be saved. A conversation is given the budget it starts on before its
 * first message is sent, so a later default leaves it where it began.
 */
export function useContextBudget(
  state: WorkspaceState,
  selectedTask: WorkspaceTask | null,
  commands: Pick<
    CoreApi,
    "setContextBudget" | "setDefaultContextBudget" | "condenseNow"
  >,
  onEditInstructions: () => void,
) {
  const [chosen, setChosen] = useState<ContextBudgetChoice>();
  const budget =
    (selectedTask ? selectedTask.contextBudget : chosen) ??
    state.contextBudget ??
    "medium";
  return {
    context: {
      ...(selectedTask?.contextUsage
        ? { usage: selectedTask.contextUsage }
        : {}),
      model: state.provider,
      budget,
      ...(selectedTask?.standingInstructions
        ? { instructions: selectedTask.standingInstructions }
        : {}),
      onEditInstructions,
      onChoose: async (choice: ContextBudgetChoice) => {
        if (selectedTask) {
          await commands.setContextBudget(selectedTask.id, choice);
          return;
        }
        const before = chosen;
        setChosen(choice);
        try {
          await commands.setDefaultContextBudget(choice);
        } catch (error) {
          setChosen(before);
          throw error;
        }
      },
      ...(selectedTask
        ? { onCondense: () => commands.condenseNow(selectedTask.id) }
        : {}),
      compacting: selectedTask
        ? state.compacting.some((item) => item.taskId === selectedTask.id)
        : false,
    },
    /** Fixes the budget a conversation just started begins on. */
    adopt: async (taskId: string) => {
      if (!selectedTask) await commands.setContextBudget(taskId, budget);
    },
  };
}
