/**
 * The questions a turn can stop and put to the person, and their answers.
 */

export type ClarificationOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type ClarificationQuestion = {
  readonly id: string;
  readonly prompt: string;
  readonly options?: readonly ClarificationOption[];
  readonly allowText?: boolean;
};

export type QuizAnswer = { readonly id: string; readonly label: string };

export type QuizQuestion = {
  readonly id: string;
  readonly prompt: string;
  readonly answers: readonly QuizAnswer[];
  readonly selection: "single" | "multiple";
  readonly correctAnswerIds: readonly string[];
  readonly explanation: string;
};

export type UserInputRequest =
  | {
      readonly kind: "clarification";
      readonly title: string;
      readonly questions: readonly ClarificationQuestion[];
    }
  | {
      readonly kind: "quiz";
      readonly title: string;
      readonly questions: readonly QuizQuestion[];
    };

/** A point at which long work stops to ask whether to go on. */
export type WorkLimit = "toolRounds" | "elapsed" | "providerCost";

/** How much work one stretch may do before it asks again. */
export type WorkAllowance = {
  readonly toolRounds: number;
  readonly elapsedMs: number;
  readonly providerCostUsd: number;
};

/**
 * Asked when a stretch of work reaches its allowance: which limits it reached,
 * what it used, and what Continue would grant, so the choice can be made
 * without knowing how the budget works.
 */
export type WorkBudgetRequest = {
  readonly kind: "workBudget";
  readonly title: string;
  readonly completedRounds: number;
  /** At least one. */
  readonly reached: readonly WorkLimit[];
  readonly elapsedMs: number;
  /** Absent when no request of this stretch reported a cost. */
  readonly costUsd?: number;
  /** What Continue grants: the same allowance again. */
  readonly allowance: WorkAllowance;
  /** Why the work may be going nowhere, when Zhiyin saw it repeat itself. */
  readonly reason?: string;
};

/**
 * A folder's AGENTS.md, shown whole before any of it reaches the model: a
 * folder may have come from anyone, and opening it is not consent. ADR 0054.
 */
export type FolderInstructionsRequest = {
  readonly kind: "folderInstructions";
  readonly title: string;
  /** The file's path inside the folder. */
  readonly path: string;
  /** The text that would be sent, cut at the limit when `truncated`. */
  readonly text: string;
  readonly truncated: boolean;
};

export type PendingUserInputRequest = (
  UserInputRequest | WorkBudgetRequest | FolderInstructionsRequest
) & {
  readonly id: string;
};

export type UserInputAnswer = {
  readonly questionId: string;
  readonly answerIds?: readonly string[];
  readonly text?: string;
};

export type UserInputResponse = {
  readonly answers: readonly UserInputAnswer[];
};
