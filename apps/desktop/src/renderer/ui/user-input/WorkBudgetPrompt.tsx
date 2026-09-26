import { useState } from "react";
import type {
  PendingUserInputRequest,
  UserInputResponse,
} from "@zhiyin/contract";
import styles from "./user-input.module.css";

/**
 * The renewable work budget's question: carry on, or pause for a report. When
 * Zhiyin saw the work repeat itself, it says so, so the choice can be judged.
 */
export function WorkBudgetPrompt({
  prompt,
  onSubmit,
}: {
  prompt: PendingUserInputRequest & { readonly kind: "workBudget" };
  onSubmit: (response: UserInputResponse) => void | Promise<void>;
}) {
  const [pending, setPending] = useState<"continue" | "pause" | null>(null);
  const [error, setError] = useState("");

  async function decide(decision: "continue" | "pause") {
    if (pending) return;
    setPending(decision);
    setError("");
    try {
      await onSubmit({
        answers: [{ questionId: "work-budget", answerIds: [decision] }],
      });
    } catch {
      setError("That choice could not be sent. Try again.");
      setPending(null);
    }
  }

  return (
    <section
      className={`${styles["user-input"]} ${styles["user-input--work-budget"]}`}
      aria-label="Work budget reached"
    >
      <header className={styles["user-input__header"]}>
        <div>
          <h3>{prompt.title}</h3>
        </div>
      </header>
      <p className={styles["work-budget__message"]}>
        This task has completed {prompt.completedRounds} tool rounds.
      </p>
      {prompt.reason && (
        <p className={styles["work-budget__message"]}>{prompt.reason}</p>
      )}
      {error && (
        <p className={styles["user-input__error"]} role="alert">
          {error}
        </p>
      )}
      <footer
        className={`${styles["user-input__footer"]} ${styles["work-budget__actions"]}`}
      >
        <button
          className="button button--quiet"
          type="button"
          disabled={pending !== null}
          onClick={() => void decide("pause")}
        >
          {pending === "pause" ? "Pausing…" : "Pause"}
        </button>
        <button
          className="button button--accent"
          type="button"
          disabled={pending !== null}
          onClick={() => void decide("continue")}
        >
          {pending === "continue" ? "Continuing…" : "Continue"}
        </button>
      </footer>
    </section>
  );
}
