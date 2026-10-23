import type { QuizOutcome } from "./quiz.js";
import styles from "./user-input.module.css";

/** What a checked quiz answer is called, by how it went. */
const outcomeWords: Record<QuizOutcome, string> = {
  correct: "correct",
  incomplete: "not enough answers",
  wrong: "incorrect",
};

/**
 * One segment per question. A filled segment is answered; the current
 * question's segment is brighter so position reads without the counter. A
 * checked quiz answer is coloured by how it went instead.
 */
export function StepTrack({
  label,
  done,
  outcomes,
  current,
}: {
  label: string;
  done: readonly boolean[];
  outcomes?: readonly (QuizOutcome | undefined)[];
  current?: number;
}) {
  return (
    <ol className={styles["step-track"]} aria-label={label}>
      {done.map((isDone, index) => {
        const outcome = isDone ? outcomes?.[index] : undefined;
        return (
          <li
            key={index}
            className={[
              styles["step-track__segment"],
              isDone ? styles["step-track__segment--done"] : "",
              outcome ? styles[`step-track__segment--${outcome}`] : "",
              index === current ? styles["step-track__segment--current"] : "",
            ].join(" ")}
            aria-current={index === current ? "step" : undefined}
            aria-label={`Question ${index + 1}: ${
              outcome
                ? outcomeWords[outcome]
                : isDone
                  ? "answered"
                  : "not answered yet"
            }`}
          />
        );
      })}
    </ol>
  );
}
