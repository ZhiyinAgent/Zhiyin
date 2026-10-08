import { Logo } from "../shared/index.js";
import styles from "./conversation.module.css";

/**
 * An empty conversation: an invitation, and a few ways to begin. While no
 * conversation can be started the ways to begin are left out rather than
 * greyed, since the notice above says why and greyed ones only ask "why not?".
 */
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
      {!disabled && (
        <div className={styles["prompt-suggestions"]}>
          {[
            "Help me think through an idea",
            "Make a plan with me",
            "Explain something new",
          ].map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              onClick={() => onSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
