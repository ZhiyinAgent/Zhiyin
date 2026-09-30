import type {
  MessageAttachment,
  ReasoningSelection,
  WorkspaceTask,
} from "@zhiyin/contract";
import { fallbackConversationTitle } from "../context/conversation-context.js";

type BeginUserTurnOptions = {
  readonly messageId: string;
  readonly sequence: number;
  readonly reasoning?: ReasoningSelection;
  readonly attachments?: readonly MessageAttachment[];
};

/** Builds the one authoritative task transition that opens a user turn. */
export function beginUserTurn(
  task: WorkspaceTask,
  message: string,
  options: BeginUserTurnOptions,
): {
  readonly task: WorkspaceTask;
  readonly shouldGenerateInitialTitle: boolean;
} {
  const shouldGenerateInitialTitle =
    task.messages.length === 0 && task.titleSource !== "manual";
  const userMessage = {
    id: options.messageId,
    role: "user" as const,
    text: message,
    ...(options.attachments?.length
      ? { attachments: options.attachments }
      : {}),
    sequence: options.sequence,
  };

  return {
    shouldGenerateInitialTitle,
    task: {
      ...task,
      ...(options.reasoning ? { reasoning: { ...options.reasoning } } : {}),
      title: shouldGenerateInitialTitle
        ? fallbackConversationTitle(message) || "Pasted text"
        : task.title,
      ...(shouldGenerateInitialTitle
        ? { titleSource: "generated" as const }
        : {}),
      updatedLabel: "Now",
      messages: [...task.messages, userMessage],
      plan: [],
      phase: { kind: "working", steps: [] },
    },
  };
}
