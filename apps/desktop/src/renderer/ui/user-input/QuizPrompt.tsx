import { useId, useState } from "react";
import type {
  PendingUserInputRequest,
  QuizQuestion,
  UserInputResponse,
} from "@zhiyin/contract";
import styles from "./user-input.module.css";
import { everyAnswer, quizOutcome, sameSet } from "./quiz.js";
import { StepTrack } from "./StepTrack.js";

type Answers = Record<string, readonly string[]>;

function quizScore(
  questions: readonly QuizQuestion[],
  selected: Answers,
): number {
  return questions.filter((question) =>
    sameSet(selected[question.id] ?? [], question.correctAnswerIds),
  ).length;
}

function quizResponse(
  prompt: PendingUserInputRequest & { readonly kind: "quiz" },
  selected: Answers,
): UserInputResponse {
  return {
    answers: prompt.questions.map((question) => ({
      questionId: question.id,
      answerIds: selected[question.id] ?? [],
    })),
  };
}

export function QuizPrompt({
  prompt,
  onSubmit,
}: {
  prompt: PendingUserInputRequest & { readonly kind: "quiz" };
  onSubmit: (response: UserInputResponse) => void | Promise<void>;
}) {
  const formId = useId();
  const [selected, setSelected] = useState<Answers>({});
  const [reviewed, setReviewed] = useState<readonly string[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const question = prompt.questions[questionIndex];

  if (!question) return null;

  const questionId = question.id;
  const questionSelection = question.selection;
  const selectedIds = selected[questionId] ?? [];
  const questionReviewed = reviewed.includes(questionId);
  const outcome = quizOutcome(question, selectedIds);

  function choose(answerId: string) {
    if (questionReviewed || pending) return;
    setSelected((current) => {
      const existing = current[questionId] ?? [];
      return {
        ...current,
        [questionId]:
          questionSelection === "multiple"
            ? existing.includes(answerId)
              ? existing.filter((id) => id !== answerId)
              : [...existing, answerId]
            : [answerId],
      };
    });
  }

  function checkAnswer() {
    if (selectedIds.length === 0 || questionReviewed) return;
    setReviewed((current) => [...current, questionId]);
  }

  function reset() {
    setSelected({});
    setReviewed([]);
    setQuestionIndex(0);
    setShowResult(false);
    setError("");
  }

  async function finish() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await onSubmit(quizResponse(prompt, selected));
    } catch {
      setError("The result could not be sent. Try finishing the quiz again.");
    } finally {
      setPending(false);
    }
  }

  if (showResult) {
    const score = quizScore(prompt.questions, selected);
    const total = prompt.questions.length;
    const resultTitle =
      score === total
        ? "Every answer landed."
        : score >= Math.ceil(total / 2)
          ? "Nearly there."
          : "Worth another pass.";
    return (
      <section
        className={`${styles["user-input"]} ${styles["user-input--quiz"]}`}
        aria-label="Quiz result"
      >
        <header className={styles["input-flow__header"]}>
          <div>
            <p>Quiz complete</p>
            <h3>{prompt.title}</h3>
          </div>
          <span>All {total} answered</span>
        </header>
        <main className={styles["quiz-result"]}>
          <p className={styles["quiz-result__eyebrow"]}>Your result</p>
          <div
            className={styles["quiz-result__score"]}
            aria-label={`${score} of ${total} correct`}
          >
            <strong>
              {score} / {total}
            </strong>
            <span>correct</span>
          </div>
          <ol
            className={styles["quiz-result__track"]}
            aria-label="Question results"
          >
            {prompt.questions.map((item, index) => {
              const itemOutcome = quizOutcome(item, selected[item.id] ?? []);
              return (
                <li
                  className={`${styles[`is-${itemOutcome}`]}`}
                  aria-label={`Question ${index + 1}: ${itemOutcome === "wrong" ? "incorrect" : itemOutcome}`}
                  key={item.id}
                >
                  {index + 1}
                </li>
              );
            })}
          </ol>
          <h4>{resultTitle}</h4>
          <p className={styles["quiz-result__summary"]}>
            Review or retry before sending this result back to the task.
          </p>
          <div className={styles["quiz-result__retry"]}>
            <div>
              <strong>Want another go?</strong>
              <span>Your next attempt starts with a clean slate.</span>
            </div>
            <button
              className="button button--quiet"
              type="button"
              disabled={pending}
              onClick={reset}
            >
              Try again
            </button>
          </div>
        </main>
        {error && (
          <p className={styles["user-input__error"]} role="alert">
            {error}
          </p>
        )}
        <footer
          className={`${styles["user-input__footer"]} ${styles["input-flow__footer"]}`}
        >
          <div className={styles["input-flow__actions"]}>
            <button
              className="button button--quiet"
              type="button"
              disabled={pending}
              onClick={() => {
                setShowResult(false);
                setQuestionIndex(total - 1);
              }}
            >
              Review answers
            </button>
            <button
              className="button button--accent"
              type="button"
              disabled={pending}
              onClick={() => void finish()}
            >
              {pending ? "Finishing…" : "Finish quiz"}
            </button>
          </div>
        </footer>
      </section>
    );
  }

  return (
    <section
      className={`${styles["user-input"]} ${styles["user-input--quiz"]}`}
      aria-label="Quiz"
    >
      <header className={styles["input-flow__header"]}>
        <div>
          <p>Knowledge check</p>
          <h3>{prompt.title}</h3>
        </div>
        <span>
          Question {questionIndex + 1} of {prompt.questions.length}
        </span>
        <StepTrack
          label="Quiz progress"
          current={questionIndex}
          done={prompt.questions.map((item) => reviewed.includes(item.id))}
          outcomes={prompt.questions.map((item) =>
            quizOutcome(item, selected[item.id] ?? []),
          )}
        />
      </header>
      <form
        id={formId}
        className={styles["input-flow__question"]}
        onSubmit={(event) => {
          event.preventDefault();
          checkAnswer();
        }}
      >
        <div
          className={styles["input-flow__question-body"]}
          role="group"
          aria-labelledby={`${formId}-question`}
        >
          <h4 id={`${formId}-question`}>{question.prompt}</h4>
          {question.selection === "multiple" && (
            <p className={styles["input-flow__hint"]}>Choose all that apply</p>
          )}
          <div className={styles["input-flow__options"]}>
            {question.answers.map((answer) => {
              const answerSelected = selectedIds.includes(answer.id);
              const answerCorrect = question.correctAnswerIds.includes(
                answer.id,
              );
              const missed =
                questionReviewed &&
                answerCorrect &&
                outcome === "incomplete" &&
                !answerSelected;
              const stateClass = questionReviewed
                ? answerCorrect
                  ? outcome === "incomplete" && !answerSelected
                    ? styles["input-flow__option--incomplete"]
                    : styles["input-flow__option--correct"]
                  : answerSelected
                    ? styles["input-flow__option--wrong"]
                    : undefined
                : answerSelected
                  ? styles["input-flow__option--selected"]
                  : undefined;
              return (
                <label
                  className={`${styles["input-flow__option"]} ${stateClass ?? ""}`}
                  key={answer.id}
                >
                  <input
                    type={
                      question.selection === "multiple" ? "checkbox" : "radio"
                    }
                    aria-label={`${answer.label}${
                      questionReviewed
                        ? answerCorrect
                          ? outcome === "incomplete" && !answerSelected
                            ? ", missed"
                            : ", correct"
                          : answerSelected
                            ? ", incorrect"
                            : ""
                        : ""
                    }`}
                    name={`${formId}-${question.id}`}
                    checked={answerSelected}
                    disabled={pending || questionReviewed}
                    onChange={() => choose(answer.id)}
                  />
                  <span>{answer.label}</span>
                  {missed && (
                    <em className={styles["input-flow__missed"]}>Missed</em>
                  )}
                </label>
              );
            })}
          </div>
        </div>
        {questionReviewed && (
          <div
            className={`${styles["input-flow__feedback"]} ${styles[`input-flow__feedback--${outcome}`]}`}
            role="status"
          >
            <strong>
              {outcome === "correct"
                ? "Correct"
                : outcome === "incomplete"
                  ? `Not quite: this needed ${everyAnswer(question)}.`
                  : "Not quite"}
            </strong>
            <p>{question.explanation}</p>
          </div>
        )}
      </form>
      <footer
        className={`${styles["user-input__footer"]} ${styles["input-flow__footer"]}`}
      >
        <div className={styles["input-flow__actions"]}>
          <button
            className="button button--quiet"
            type="button"
            disabled={pending || questionIndex === 0}
            onClick={() => setQuestionIndex((current) => current - 1)}
          >
            Previous question
          </button>
          {questionReviewed ? (
            <button
              className="button button--accent"
              type="button"
              onClick={() => {
                if (questionIndex === prompt.questions.length - 1) {
                  setShowResult(true);
                } else {
                  setQuestionIndex((current) => current + 1);
                }
              }}
            >
              {questionIndex === prompt.questions.length - 1
                ? "See result"
                : "Next question"}
            </button>
          ) : (
            <button
              className="button button--accent"
              type="submit"
              form={formId}
              disabled={selectedIds.length === 0}
              data-tip={
                selectedIds.length === 0 ? "Choose an answer first" : undefined
              }
            >
              Check answer
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
