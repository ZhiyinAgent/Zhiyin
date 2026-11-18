import type { ReactNode } from "react";
import type { CoreApi } from "@zhiyin/contract";
import type { DeleteConversation } from "../sidebar/index.js";
import type { WindowState } from "./windowState.js";
import { useToast } from "../notices/index.js";

/**
 * Deletes a conversation and, once the core has, says so by name. Asked to,
 * it then forgets what the conversation kept in memory. A failure says
 * nothing here; `act` reports it.
 */
export function useConversationDeletion(
  state: Pick<WindowState, "tasks" | "conversations">,
  commands: Pick<CoreApi, "deleteTask" | "changeMemory">,
  act: (operation: () => Promise<unknown>) => Promise<void>,
): readonly [ReactNode, DeleteConversation] {
  const [toast, showToast] = useToast();
  const deleteConversation: DeleteConversation = (id, forget) => {
    const title = [...state.tasks, ...state.conversations].find(
      (item) => item.id === id,
    )?.title;
    void act(async () => {
      await commands.deleteTask(id);
      showToast(title ? `Deleted “${title}”.` : "Conversation deleted.");
      if (!forget?.own && !forget?.general) return;
      const forgotten = await commands.changeMemory({
        kind: "forgetConversation",
        taskId: id,
        ...forget,
      });
      if (!forgotten.ok) throw new Error(forgotten.reason);
    });
  };
  return [toast, deleteConversation];
}
