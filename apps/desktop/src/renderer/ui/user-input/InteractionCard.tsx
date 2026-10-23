import type { TaskInteraction } from "@zhiyin/contract";
import { everyAnswer, quizOutcome, sameSet } from "./quiz.js";
import styles from "./user-input.module.css";

function selectedLabels(
  interaction: TaskInteraction,
  questionId: string,
): string[] {
  const response = interaction.response.answers.find(
    (answer) => answer.questionId === questionId,
  );
  if (response?.text) return [response.text];
  const ids = response?.answerIds ?? [];
  const question = interaction.request.questions.find(
    (candidate) => candidate.id === questionId,
  );
  const options =
    interaction.request.kind === "quiz"
      ? ((
          question as Extract<typeof question, { answers: unknown }> | undefined
        )?.answers ?? [])
      : ((
          question as
            Extract<typeof question, { options?: unknown }> | undefined
        )?.options ?? []);
  return ids.map(
    (id) =>
      options.find((option: { id: string }) => option.id === id)?.label ?? id,
  );
}

type ScoreBand = "strong" | "fair" | "weak" | "poor";

/** Bands follow the product scale: 80%+ strong, 50%+ fair, 30%+ weak. */
function scoreBand(score: number, total: number): ScoreBand {
  const ratio = total === 0 ? 0 : score / total;
  if (ratio >= 0.8) return "strong";
  if (ratio >= 0.5) return "fair";
  if (ratio >= 0.3) return "weak";
  return "poor";
}

export function InteractionCard({
  interaction,
}: {
  interaction: TaskInteraction;
}) {
  const quiz = interaction.request.kind === "quiz";
  const score = quiz
    ? interaction.request.questions.filter((question) => {
        const selected =
          interaction.response.answers.find(
            (answer) => answer.questionId === question.id,
          )?.answerIds ?? [];
        return sameSet(selected, question.correctAnswerIds);
      }).length
    : 0;
  return (
    <section
      className={`${styles["interaction-card"]} ${styles[`interaction-card--${interaction.request.kind}`]}`}
      aria-label={`${interaction.request.title} ${quiz ? "quiz result" : "answers"}`}
    >
      <header className={styles["interaction-card__header"]}>
        <div>
          <p>{quiz ? "Quiz complete" : "Answered"}</p>
          <h3>{interaction.request.title}</h3>
        </div>
        {quiz && (
          <strong
            className={`${styles["interaction-card__score"]} ${
              styles[
                `interaction-card__score--${scoreBand(
                  score,
                  interaction.request.questions.length,
                )}`
              ]
            }`}
          >
            {score} of {interaction.request.questions.length} correct
          </strong>
        )}
      </header>
      <div className={styles["interaction-card__answers"]}>
        {interaction.request.questions.map((question, index) => {
          const labels = selectedLabels(interaction, question.id);
          const selectedIds =
            interaction.response.answers.find(
              (answer) => answer.questionId === question.id,
            )?.answerIds ?? [];
          const outcome =
            quiz &&
            "correctAnswerIds" in question &&
            quizOutcome(question, selectedIds);
          return (
            <div
              className={`${styles["interaction-card__answer"]}${outcome ? ` ${styles[`interaction-card__answer--${outcome}`]}` : ""}`}
              role="group"
              aria-label={question.prompt}
              key={question.id}
            >
              <p>
                <span>{index + 1}</span>
                {question.prompt}
              </p>
              <strong>{labels.join(", ")}</strong>
              {outcome && (
                <em>
                  {outcome === "correct"
                    ? "Correct"
                    : outcome === "incomplete" && "correctAnswerIds" in question
                      ? `Needed ${everyAnswer(question)}`
                      : "Incorrect"}
                </em>
              )}
              {"explanation" in question && question.explanation && (
                <small>{question.explanation}</small>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
