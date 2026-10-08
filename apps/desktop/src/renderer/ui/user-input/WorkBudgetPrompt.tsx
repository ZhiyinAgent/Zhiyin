import { useState } from "react";
import type {
  PendingUserInputRequest,
  UserInputResponse,
  WorkBudgetRequest,
} from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./user-input.module.css";

/**
 * The renewable work budget's question: keep going, or stop and report. One
 * sentence says which checkpoint the work reached; nothing else competes with
 * the choice. When Zhiyin saw the work repeat itself, it says so, so the
 * choice can be judged.
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
      className={`${styles["user-input"]} ${styles["work-budget"]}`}
      aria-label="Work budget reached"
    >
      <span className={styles["work-budget__icon"]} aria-hidden="true">
        <Icon name="clock" />
      </span>
      <div className={styles["work-budget__text"]}>
        <h3>{prompt.title}</h3>
        <p>{headline(prompt)}</p>
        {prompt.reason && (
          <p className={styles["work-budget__warning"]}>
            <Icon name="alert" />
            <span>{prompt.reason}</span>
          </p>
        )}
        {error && (
          <p className={styles["work-budget__error"]} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={styles["work-budget__actions"]}>
        <button
          className="button button--quiet"
          type="button"
          disabled={pending !== null}
          onClick={() => void decide("pause")}
        >
          {pending === "pause" ? "Stopping…" : "Stop and summarise"}
        </button>
        <button
          className="button button--accent"
          type="button"
          disabled={pending !== null}
          onClick={() => void decide("continue")}
        >
          {pending === "continue" ? "Continuing…" : "Keep going"}
        </button>
      </div>
    </section>
  );
}

function headline(prompt: WorkBudgetRequest): string {
  switch (prompt.reached[0]) {
    case "elapsed":
      return `Zhiyin has been working for ${duration(prompt.elapsedMs)}.`;
    case "providerCost":
      return `This task has cost $${(prompt.costUsd ?? prompt.allowance.providerCostUsd).toFixed(2)} so far.`;
    default:
      return `Zhiyin has taken ${prompt.completedRounds} ${prompt.completedRounds === 1 ? "step" : "steps"}.`;
  }
}

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
