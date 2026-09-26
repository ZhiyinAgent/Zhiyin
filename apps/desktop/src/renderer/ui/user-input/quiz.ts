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
