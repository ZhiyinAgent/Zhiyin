import { Logo } from "../shared/index.js";
import styles from "./conversation.module.css";

/** An empty conversation: an invitation, and a few ways to begin. */
export function NewConversation({
  onSuggestion,
  disabled = false,
}: {
  onSuggestion: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles["new-view"]}>
      <div className={styles["welcome-orbit"]} aria-hidden="true">
        <Logo compact size={44} />
        <span className={styles["welcome-orbit__ring"]} />
        <span className={styles["welcome-orbit__ring"]} />
      </div>
      <h1>What should we work on?</h1>
      <p>
        A thought, a question, a possibility.
        <br />
        Let’s make something of it.
      </p>
      <div className={styles["prompt-suggestions"]}>
        {[
          "Help me think through an idea",
          "Make a plan with me",
          "Explain something new",
        ].map((suggestion) => (
          <button
            type="button"
            key={suggestion}
            disabled={disabled}
            onClick={() => onSuggestion(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
