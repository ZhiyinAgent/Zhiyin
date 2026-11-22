import { useState } from "react";
import type {
  PendingUserInputRequest,
  UndoRoomChoice,
  UserInputResponse,
} from "@zhiyin/contract";
import { Icon, fileSize } from "../shared/index.js";
import styles from "./user-input.module.css";

/** Each answer as its button names it, and while it is being sent. */
const answers: readonly {
  readonly choice: UndoRoomChoice;
  readonly label: string;
  readonly sending: string;
  readonly accent?: true;
}[] = [
  { choice: "refuse", label: "Refuse", sending: "Refusing…" },
  { choice: "make-room", label: "Make room", sending: "Making room…" },
  {
    choice: "without",
    label: "Change without a backup",
    sending: "Changing…",
    accent: true,
  },
];

/**
 * A first write the undo budget has no room to keep a backup for (ADR 0031).
 * The program writing waits on the answer; the card says what each answer
 * does, so the choice can be made without knowing how the budget works.
 */
export function UndoRoomPrompt({
  prompt,
  onSubmit,
}: {
  prompt: PendingUserInputRequest & { readonly kind: "undoRoom" };
  onSubmit: (response: UserInputResponse) => void | Promise<void>;
}) {
  const [pending, setPending] = useState<UndoRoomChoice | null>(null);
  const [error, setError] = useState("");

  async function decide(choice: UndoRoomChoice) {
    if (pending) return;
    setPending(choice);
    setError("");
    try {
      await onSubmit({
        answers: [{ questionId: "undo-room", answerIds: [choice] }],
      });
    } catch {
      setError("That choice could not be sent. Try again.");
      setPending(null);
    }
  }

  return (
    <section
      className={`${styles["user-input"]} ${styles["work-budget"]}`}
      aria-label="No room to keep a backup"
    >
      <span className={styles["work-budget__icon"]} aria-hidden="true">
        <Icon name="alert" />
      </span>
      <div className={styles["work-budget__text"]}>
        <h3>{prompt.title}</h3>
        <p>
          A program is about to change <code>{prompt.path}</code> (
          {fileSize(prompt.bytes)}), and only {fileSize(prompt.roomBytes)} of
          the {fileSize(prompt.budgetBytes)} kept for going back is free. It
          waits for your answer.
        </p>
        <p>
          Make room lets go of older versions, including files as they were
          before this conversation changed them. Refuse stops the program&apos;s
          change to this file. You can change the room in Settings.
        </p>
        {error && (
          <p className={styles["work-budget__error"]} role="alert">
            {error}
          </p>
        )}
      </div>
      <div
        className={`${styles["work-budget__actions"]} ${styles["undo-room__actions"]}`}
      >
        {answers.map((answer) => (
          <button
            key={answer.choice}
            className={`button ${answer.accent ? "button--accent" : "button--quiet"}`}
            type="button"
            disabled={pending !== null}
            onClick={() => void decide(answer.choice)}
          >
            {pending === answer.choice ? answer.sending : answer.label}
          </button>
        ))}
      </div>
    </section>
  );
}
