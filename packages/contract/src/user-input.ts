/**
 * The questions a turn can stop and put to the person, and their answers.
 */

import type { MoneyAmount } from "./models.js";

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
  /**
   * The cost limits in other currencies, such as yuan on a mainland China
   * platform. A cost is never converted to meet the dollar limit.
   */
  readonly providerCosts?: readonly MoneyAmount[];
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
  /**
   * What the requests whose provider reported no cost came to by the shipped
   * price lists, in each currency apart. Absent when none was estimated.
   */
  readonly estimatedCosts?: readonly MoneyAmount[];
  /**
   * What Continue grants: the same time and cost again, and twice the rounds
   * of the stretch that just ended (ADR 0018).
   */
  readonly allowance: WorkAllowance;
  /** Why the work may be going nowhere, when Zhiyin saw it repeat itself. */
  readonly reason?: string;
  /**
   * The same figures for the whole task, from its start, once the person has
   * chosen Continue: the figures above then cover only the stretch since.
   */
  readonly sinceStart?: WorkSoFar;
};

/** What work has used: its rounds, its time and its cost. */
export type WorkSoFar = {
  readonly completedRounds: number;
  readonly elapsedMs: number;
  /** Absent when no request reported a cost. */
  readonly costUsd?: number;
  /** Absent when no cost was estimated from price lists. */
  readonly estimatedCosts?: readonly MoneyAmount[];
};

/**
 * A folder's AGENTS.md, shown whole before any of it reaches the model: a
 * folder may have come from anyone, and opening it is not consent. ADR 0017.
 */
export type FolderInstructionsRequest = {
  readonly kind: "folderInstructions";
  readonly title: string;
  /** The file's path inside the folder. */
  readonly path: string;
  /**
   * The text the person approves, cut at the most any conversation sends when
   * `truncated`.
   */
  readonly text: string;
  readonly truncated: boolean;
  /**
   * Set when this conversation's budget sends only the start: the last line
   * it sends. A conversation with a larger budget sends more.
   */
  readonly sentThroughLine?: number;
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
