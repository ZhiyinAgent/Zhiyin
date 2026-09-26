import { useId, useState } from "react";
import type {
  ClarificationOption,
  PendingUserInputRequest,
  QuizAnswer,
  QuizQuestion,
  TaskInteraction,
  UserInputResponse,
} from "@zhiyin/contract";
import styles from "./user-input.module.css";
import { WorkBudgetPrompt } from "./WorkBudgetPrompt.js";

type Answers = Record<string, readonly string[]>;
type TextAnswers = Record<string, string>;
type QuestionPrompt = Exclude<
  PendingUserInputRequest,
  { readonly kind: "workBudget" }
>;

function optionDescription(
  option: ClarificationOption | QuizAnswer,
): string | undefined {
  return "description" in option ? option.description : undefined;
}

function responseFrom(
  prompt: QuestionPrompt,
  selected: Answers,
  written: TextAnswers,
): UserInputResponse {
  return {
    answers: prompt.questions.map((question) => {
      const text = written[question.id]?.trim();
      return text
        ? { questionId: question.id, text }
        : { questionId: question.id, answerIds: selected[question.id] ?? [] };
    }),
  };
}

function complete(
  prompt: QuestionPrompt,
  selected: Answers,
  written: TextAnswers,
): boolean {
  return prompt.questions.every((question) => {
    const choices = selected[question.id] ?? [];
    const text = written[question.id]?.trim();
    return choices.length > 0 || Boolean(text);
  });
}

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

function answeredCount(
  prompt: QuestionPrompt,
  selected: Answers,
  written: TextAnswers,
): number {
  return prompt.questions.filter(
    (question) =>
      (selected[question.id] ?? []).length > 0 ||
      Boolean(written[question.id]?.trim()),
  ).length;
}

function ClarificationPrompt({
  prompt,
  onSubmit,
  onCancel,
}: {
  prompt: PendingUserInputRequest & { readonly kind: "clarification" };
  onSubmit: (response: UserInputResponse) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}) {
  const formId = useId();
  const [selected, setSelected] = useState<Answers>({});
  const [written, setWritten] = useState<TextAnswers>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [showReview, setShowReview] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const total = prompt.questions.length;
  const stepped = total > 1;
  const question = prompt.questions[questionIndex];

  if (!question) return null;

  const questionId = question.id;
  const options = question.options ?? [];
  const selectedIds = selected[questionId] ?? [];
  const text = written[questionId] ?? "";
  const answered = selectedIds.length > 0 || Boolean(text.trim());

  function choose(answerId: string) {
    if (pending) return;
    setSelected((current) => ({ ...current, [questionId]: [answerId] }));
    setWritten((current) => ({ ...current, [questionId]: "" }));
  }

  function write(value: string) {
    setWritten((current) => ({ ...current, [questionId]: value }));
    if (value) setSelected((current) => ({ ...current, [questionId]: [] }));
  }

  async function submit() {
    if (pending || !complete(prompt, selected, written)) return;
    setPending(true);
    setError("");
    try {
      await onSubmit(responseFrom(prompt, selected, written));
    } catch {
      setError(
        "The answer could not be sent. Check your choices and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const stopTask = (
    <button
      className="button button--quiet"
      type="button"
      disabled={pending}
      onClick={() => void onCancel()}
    >
      Stop task
    </button>
  );

  if (showReview) {
    return (
      <section
        className={`${styles["user-input"]} ${styles["user-input--clarification"]}`}
        aria-label="Review clarifying answers"
      >
        <header className={styles["input-flow__header"]}>
          <div>
            <p>A few details</p>
            <h3>{prompt.title}</h3>
          </div>
          <span>All {total} answered</span>
          <progress aria-label="Answer progress" value={total} max={total} />
        </header>
        <ol className={styles["input-review"]}>
          {prompt.questions.map((item, index) => (
            <li className={styles["input-review__row"]} key={item.id}>
              <div>
                <p>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {item.prompt}
                </p>
                <strong>
                  {written[item.id]?.trim() ||
                    (selected[item.id] ?? [])
                      .map(
                        (id) =>
                          (item.options ?? []).find(
                            (option) => option.id === id,
                          )?.label ?? id,
                      )
                      .join(", ")}
                </strong>
              </div>
              <button
                className="button button--quiet"
                type="button"
                aria-label={`Change answer to ${item.prompt}`}
                disabled={pending}
                onClick={() => {
                  setShowReview(false);
                  setQuestionIndex(index);
                }}
              >
                Change
              </button>
            </li>
          ))}
        </ol>
        {error && (
          <p className={styles["user-input__error"]} role="alert">
            {error}
          </p>
        )}
        <footer
          className={`${styles["user-input__footer"]} ${styles["input-flow__footer"]}`}
        >
          {stopTask}
          <div className={styles["input-flow__actions"]}>
            <button
              className="button button--quiet"
              type="button"
              disabled={pending}
              onClick={() => {
                setShowReview(false);
                setQuestionIndex(total - 1);
              }}
            >
              Back
            </button>
            <button
              className="button button--accent"
              type="button"
              disabled={pending}
              onClick={() => void submit()}
            >
              {pending ? "Sending…" : "Send answers"}
            </button>
          </div>
        </footer>
      </section>
    );
  }

  const last = questionIndex === total - 1;

  return (
    <section
      className={`${styles["user-input"]} ${styles["user-input--clarification"]}`}
      aria-label="Clarifying questions"
    >
      <header className={styles["input-flow__header"]}>
        <div>
          <p>A few details</p>
          <h3>{prompt.title}</h3>
        </div>
        {stepped && (
          <span>
            Question {questionIndex + 1} of {total}
          </span>
        )}
        {stepped && (
          <progress
            aria-label="Answer progress"
            value={answeredCount(prompt, selected, written)}
            max={total}
          />
        )}
      </header>
      <form
        id={formId}
        className={styles["input-flow__question"]}
        onSubmit={(event) => {
          event.preventDefault();
          if (!answered) return;
          if (!last) setQuestionIndex((current) => current + 1);
          else if (stepped) setShowReview(true);
          else void submit();
        }}
      >
        <div
          className={styles["input-flow__question-body"]}
          role="group"
          aria-labelledby={`${formId}-question`}
        >
          <h4 id={`${formId}-question`}>{question.prompt}</h4>
          <div className={styles["input-flow__options"]}>
            {options.map((option) => (
              <label
                className={`${styles["input-flow__option"]} ${
                  selectedIds.includes(option.id)
                    ? styles["input-flow__option--selected"]
                    : ""
                }`}
                key={option.id}
              >
                <input
                  type="radio"
                  aria-label={option.label}
                  name={`${formId}-${question.id}`}
                  checked={selectedIds.includes(option.id)}
                  disabled={pending}
                  onChange={() => choose(option.id)}
                />
                <span>
                  <strong>{option.label}</strong>
                  {optionDescription(option) && (
                    <small>{optionDescription(option)}</small>
                  )}
                </span>
              </label>
            ))}
            {question.allowText && (
              <label className={styles["user-input__written"]}>
                {options.length > 0 && <span>Something else</span>}
                <textarea
                  aria-label={
                    options.length
                      ? `${question.prompt} — Something else`
                      : question.prompt
                  }
                  rows={options.length ? 2 : 3}
                  placeholder={
                    options.length ? "Describe another option" : "Your answer"
                  }
                  value={text}
                  disabled={pending}
                  onChange={(event) => write(event.target.value)}
                />
              </label>
            )}
          </div>
        </div>
      </form>
      {error && (
        <p className={styles["user-input__error"]} role="alert">
          {error}
        </p>
      )}
      <footer
        className={`${styles["user-input__footer"]} ${styles["input-flow__footer"]}`}
      >
        {stopTask}
        <div className={styles["input-flow__actions"]}>
          {stepped && (
            <button
              className="button button--quiet"
              type="button"
              disabled={pending || questionIndex === 0}
              onClick={() => setQuestionIndex((current) => current - 1)}
            >
              Previous question
            </button>
          )}
          <button
            className="button button--accent"
            type="submit"
            form={formId}
            disabled={pending || !answered}
          >
            {!stepped
              ? pending
                ? "Sending…"
                : "Send answer"
              : last
                ? "Review answers"
                : "Next question"}
          </button>
        </div>
      </footer>
    </section>
  );
}

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

type QuizOutcome = "correct" | "incomplete" | "wrong";

function quizOutcome(
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

function QuizPrompt({
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
        <progress
          aria-label="Quiz progress"
          value={questionIndex + 1}
          max={prompt.questions.length}
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
                  ? "Incomplete"
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
            >
              Check answer
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

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

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
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
                    : outcome === "incomplete"
                      ? "Incomplete"
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
