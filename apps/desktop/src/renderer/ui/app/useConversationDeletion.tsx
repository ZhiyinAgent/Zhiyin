import type { ReactNode } from "react";
import type { CoreApi } from "@zhiyin/contract";
import type { WorkspaceState } from "./workspaceState.js";
import { useToast } from "./Toast.js";

/**
 * Deletes a conversation and, once the core has, says so by name. A deletion
 * that fails says nothing here; `act` reports the failure.
 */
export function useConversationDeletion(
  state: Pick<WorkspaceState, "tasks" | "conversations">,
  deleteTask: CoreApi["deleteTask"],
  act: (operation: () => Promise<unknown>) => Promise<void>,
): readonly [ReactNode, (id: string) => void] {
  const [toast, showToast] = useToast();
  const deleteConversation = (id: string) => {
    const title = [...state.tasks, ...state.conversations].find(
      (item) => item.id === id,
    )?.title;
    void act(async () => {
      await deleteTask(id);
      showToast(title ? `Deleted “${title}”.` : "Conversation deleted.");
    });
  };
  return [toast, deleteConversation];
}
