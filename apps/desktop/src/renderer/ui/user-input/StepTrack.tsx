import styles from "./user-input.module.css";

/**
 * One segment per question. A filled segment is answered; the current
 * question's segment is brighter so position reads without the counter.
 */
export function StepTrack({
  label,
  done,
  current,
}: {
  label: string;
  done: readonly boolean[];
  current?: number;
}) {
  return (
    <ol className={styles["step-track"]} aria-label={label}>
      {done.map((isDone, index) => (
        <li
          key={index}
          className={[
            styles["step-track__segment"],
            isDone ? styles["step-track__segment--done"] : "",
            index === current ? styles["step-track__segment--current"] : "",
          ].join(" ")}
          aria-current={index === current ? "step" : undefined}
          aria-label={`Question ${index + 1}: ${isDone ? "answered" : "not answered yet"}`}
        />
      ))}
    </ol>
  );
}
