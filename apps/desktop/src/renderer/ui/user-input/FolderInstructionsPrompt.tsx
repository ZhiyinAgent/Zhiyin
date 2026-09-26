import { useState } from "react";
import type {
  PendingUserInputRequest,
  UserInputResponse,
} from "@zhiyin/contract";
import styles from "./user-input.module.css";

/**
 * A folder's AGENTS.md, shown in full before any of it reaches the model
 * (ADR 0054). The folder may have come from anyone, so the person reads the
 * exact text and chooses; the answer holds until the file changes.
 */
export function FolderInstructionsPrompt({
  prompt,
  onSubmit,
}: {
  prompt: PendingUserInputRequest & { readonly kind: "folderInstructions" };
  onSubmit: (response: UserInputResponse) => void | Promise<void>;
}) {
  const [pending, setPending] = useState<"use" | "ignore" | null>(null);
  const [error, setError] = useState("");

  async function decide(answer: "use" | "ignore") {
    if (pending) return;
    setPending(answer);
    setError("");
    try {
      await onSubmit({
        answers: [{ questionId: "folder-instructions", answerIds: [answer] }],
      });
    } catch {
      setError("That choice could not be sent. Try again.");
      setPending(null);
    }
  }

  return (
    <section
      className={`${styles["user-input"]} ${styles["user-input--folder-instructions"]}`}
      aria-label="Folder instructions"
    >
      <header className={styles["user-input__header"]}>
        <div>
          <h3>{prompt.title}</h3>
        </div>
      </header>
      <p className={styles["work-budget__message"]}>
        This folder has instructions for the assistant in{" "}
        <code>{prompt.path}</code>. They guide style and approach, and never
        grant permission: every action is still checked as usual.
        {prompt.truncated &&
          " It is shortened: only the first 16 KB, shown here, would be used."}
      </p>
      <pre className={styles["folder-instructions__text"]}>{prompt.text}</pre>
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
          onClick={() => void decide("ignore")}
        >
          {pending === "ignore" ? "Ignoring…" : "Ignore them"}
        </button>
        <button
          className="button button--accent"
          type="button"
          disabled={pending !== null}
          onClick={() => void decide("use")}
        >
          {pending === "use" ? "Using…" : "Use them"}
        </button>
      </footer>
    </section>
  );
}
