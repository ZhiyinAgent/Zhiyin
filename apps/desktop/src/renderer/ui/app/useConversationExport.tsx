import { useState } from "react";
import type { ArtifactExport, ConversationFormat } from "@zhiyin/contract";
import { ExportConversationDialog } from "./ExportConversationDialog.js";

/** Which conversation is being exported, and the dialog that asks how. */
export function useConversationExport(
  conversations: readonly { readonly id: string; readonly title: string }[],
  save: (id: string, format: ConversationFormat) => Promise<ArtifactExport>,
  showInFolder: ((path: string) => void) | undefined,
) {
  const [id, open] = useState<string>();
  const conversation = conversations.find((item) => item.id === id);
  const panel = conversation ? (
    <ExportConversationDialog
      key={conversation.id}
      title={conversation.title}
      onExport={(format) => save(conversation.id, format)}
      onShowInFolder={showInFolder}
      onClose={() => open(undefined)}
    />
  ) : null;
  return { open, panel };
}
