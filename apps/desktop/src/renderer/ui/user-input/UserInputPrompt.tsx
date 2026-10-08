import type {
  PendingUserInputRequest,
  UserInputResponse,
} from "@zhiyin/contract";
import { ClarificationPrompt } from "./ClarificationPrompt.js";
import { FolderInstructionsPrompt } from "./FolderInstructionsPrompt.js";
import { QuizPrompt } from "./QuizPrompt.js";
import { WorkBudgetPrompt } from "./WorkBudgetPrompt.js";

export { InteractionCard } from "./InteractionCard.js";

export function UserInputPrompt({
  prompt,
  onSubmit,
  onCancel,
}: {
  prompt: PendingUserInputRequest;
  onSubmit: (response: UserInputResponse) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}) {
  return prompt.kind === "workBudget" ? (
    <WorkBudgetPrompt prompt={prompt} onSubmit={onSubmit} />
  ) : prompt.kind === "folderInstructions" ? (
    <FolderInstructionsPrompt prompt={prompt} onSubmit={onSubmit} />
  ) : prompt.kind === "quiz" ? (
    <QuizPrompt prompt={prompt} onSubmit={onSubmit} />
  ) : (
    <ClarificationPrompt
      prompt={prompt}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}
