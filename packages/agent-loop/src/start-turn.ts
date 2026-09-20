import type { ReasoningSelection, WorkspaceTask } from "@zhiyin/contract";
import { fallbackConversationTitle } from "./conversation-context.js";

type BeginUserTurnOptions = {
  readonly messageId: string;
  readonly sequence: number;
  readonly reasoning?: ReasoningSelection;
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
    sequence: options.sequence,
  };

  return {
    shouldGenerateInitialTitle,
    task: {
      ...task,
      ...(options.reasoning ? { reasoning: { ...options.reasoning } } : {}),
      title: shouldGenerateInitialTitle
        ? fallbackConversationTitle(message)
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
