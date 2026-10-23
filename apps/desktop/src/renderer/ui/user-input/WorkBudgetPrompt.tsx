import { useState } from "react";
import type {
  PendingUserInputRequest,
  UserInputResponse,
  WorkBudgetRequest,
  WorkSoFar,
} from "@zhiyin/contract";
import { formatMoney, Icon } from "../shared/index.js";
import styles from "./user-input.module.css";

/**
 * The renewable work budget's question: keep going, or stop and report. One
 * sentence says which checkpoint the work reached; nothing else competes with
 * the choice. After Keep going, it gives the whole task's figure and the
 * stretch's apart. When Zhiyin saw the work repeat itself, it says so, so the
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
  const task = prompt.sinceStart;
  const since = " since you last chose Keep going";
  switch (prompt.reached[0]) {
    case "elapsed":
      return task
        ? `Zhiyin has been working for ${duration(task.elapsedMs)}, and for ${duration(prompt.elapsedMs)}${since}.`
        : `Zhiyin has been working for ${duration(prompt.elapsedMs)}.`;
    case "providerCost": {
      const estimated = (task ?? prompt).estimatedCosts?.length
        ? "an estimated "
        : "";
      return task
        ? `This task has cost ${estimated}${spent(task, prompt)} so far, ${spent(prompt, prompt)}${since}.`
        : `This task has cost ${estimated}${spent(prompt, prompt)} so far.`;
    }
    default:
      return task
        ? `Zhiyin has taken ${steps(task.completedRounds)}, ${prompt.completedRounds}${since}.`
        : `Zhiyin has taken ${steps(prompt.completedRounds)}.`;
  }
}

function steps(count: number): string {
  return `${count} ${count === 1 ? "step" : "steps"}`;
}

/**
 * What the work cost, each currency apart: reported dollars, with any
 * estimate from price lists added to its own currency, never converted.
 */
function spent(work: WorkSoFar, prompt: WorkBudgetRequest): string {
  const amounts = new Map<string, number>();
  if (work.costUsd !== undefined) amounts.set("USD", work.costUsd);
  for (const { currency, amount } of work.estimatedCosts ?? [])
    amounts.set(currency, (amounts.get(currency) ?? 0) + amount);
  if (amounts.size === 0)
    return formatMoney(prompt.allowance.providerCostUsd, "USD");
  return [...amounts]
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" and ");
}

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
