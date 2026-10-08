import { useId, useState } from "react";
import type {
  ClarificationOption,
  PendingUserInputRequest,
  QuizAnswer,
  UserInputResponse,
} from "@zhiyin/contract";
import styles from "./user-input.module.css";
import { StepTrack } from "./StepTrack.js";

type Answers = Record<string, readonly string[]>;
type TextAnswers = Record<string, string>;
type QuestionPrompt = Exclude<
  PendingUserInputRequest,
  { readonly kind: "workBudget" | "folderInstructions" }
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

export function ClarificationPrompt({
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
  const [confirmingStop, setConfirmingStop] = useState(false);
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

  /**
   * Quiet, beside the answers rather than among them, and asked about once in
   * place: stopping ends the task, and it sits a short reach from Next.
   */
  const stopTask = confirmingStop ? (
    <div
      className={styles["input-flow__stop"]}
      role="group"
      aria-label="Stop this task"
    >
      <span>Stop this task?</span>
      <button
        className={`button button--small ${styles["input-flow__stop-confirm"]}`}
        type="button"
        disabled={pending}
        onClick={() => void onCancel()}
      >
        Stop
      </button>
      <button
        className="button button--small button--quiet"
        type="button"
        disabled={pending}
        onClick={() => setConfirmingStop(false)}
      >
        Keep answering
      </button>
    </div>
  ) : (
    <button
      className="text-button"
      type="button"
      disabled={pending}
      onClick={() => setConfirmingStop(true)}
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
          <StepTrack
            label="Answer progress"
            done={prompt.questions.map(() => true)}
          />
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
          <StepTrack
            label="Answer progress"
            current={questionIndex}
            done={prompt.questions.map(
              (item) =>
                (selected[item.id] ?? []).length > 0 ||
                Boolean(written[item.id]?.trim()),
            )}
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
            data-tip={
              !pending && !answered ? "Answer this question first" : undefined
            }
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
