import type { QuizQuestion } from "@zhiyin/contract";

export function sameSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

export type QuizOutcome = "correct" | "incomplete" | "wrong";

export function quizOutcome(
  question: QuizQuestion,
  selectedIds: readonly string[],
): QuizOutcome {
  if (sameSet(selectedIds, question.correctAnswerIds)) return "correct";
  if (
    question.selection === "multiple" &&
    selectedIds.every((id) => question.correctAnswerIds.includes(id))
  )
    return "incomplete";
  return "wrong";
}

/**
 * What a multiple-answer question needed, for when only some of it was chosen.
 * Every correct answer is needed; the ones left out are not alternatives.
 */
export function everyAnswer(question: QuizQuestion): string {
  const count = question.correctAnswerIds.length;
  return count === 2 ? "both answers" : `all ${count} answers`;
}
