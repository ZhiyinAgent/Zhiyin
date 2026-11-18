import type { ReactNode } from "react";
import styles from "./shared.module.css";

/**
 * The question asked before something that cannot be taken back, and its two
 * answers: keep things as they are, first, or act. The question is announced
 * as it appears. Where it stands, and any frame around it, are its holder's.
 */
export function ConfirmChoice({
  question,
  detail,
  children,
  keep = "Keep",
  act,
  onKeep,
  onAct,
  busy = false,
  small = false,
}: {
  question: ReactNode;
  /** What acting does, under the question. */
  detail?: ReactNode;
  /** A choice about how to act, between the question and its answers. */
  children?: ReactNode;
  keep?: string;
  act: string;
  onKeep: () => void;
  onAct: () => void;
  /** While an answer is on its way, neither can be pressed again. */
  busy?: boolean;
  /** Smaller answers, where the question stands in a narrow place. */
  small?: boolean;
}) {
  const size = small ? " button--small" : "";
  return (
    <div className={styles["confirm-choice"]}>
      <div className={styles["confirm-choice__words"]} role="alert">
        <p className={styles["confirm-choice__question"]}>{question}</p>
        {detail && <p className={styles["confirm-choice__detail"]}>{detail}</p>}
      </div>
      {children}
      <div className={styles["confirm-choice__answers"]}>
        <button
          className={`button${size}`}
          type="button"
          disabled={busy}
          onClick={onKeep}
        >
          {keep}
        </button>
        <button
          className={`button button--accent${size}`}
          type="button"
          disabled={busy}
          onClick={onAct}
        >
          {act}
        </button>
      </div>
    </div>
  );
}
