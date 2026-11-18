import type { ReactNode } from "react";
import { Logo } from "../shared/index.js";
import styles from "./conversation.module.css";

/** A way to begin that a plugin offers, in its own words, with its name. */
export type Starter = { readonly plugin: string; readonly prompt: string };

/** At most this many ways to begin, two rows of two. */
const mostStarters = 4;

/** Where to begin when no plugin that is on offers a way. */
const general = [
  "Help me think through an idea",
  "Make a plan with me",
  "Explain something new",
];

/**
 * An empty conversation: an invitation, and a few ways to begin. A way to
 * begin fills the message rather than sending it, so a folder or a file can
 * be added first. The ways are those the plugins that are on offer, one each,
 * and a few general ones where none does. Handed a way to connect a model, it
 * shows that in their place, since nothing can begin before one. While no
 * conversation can be started the ways to begin are left out rather than
 * greyed, since the notice above says why and greyed ones only ask "why not?".
 */
export function NewConversation({
  onSuggestion,
  disabled = false,
  starters = [],
  setup,
}: {
  onSuggestion: (value: string) => void;
  disabled?: boolean;
  starters?: readonly Starter[];
  /** How to connect a model, shown while none is ready to answer. */
  setup?: ReactNode;
}) {
  const offered = starters.slice(0, mostStarters);
  return (
    // A look may draw a veil past the words, which the column must not clip.
    <div className={styles["new-view"]} data-draws-outside>
      {/* Connecting a model takes the mark's room: it is what comes first. */}
      {!setup && (
        <div className={styles["welcome-orbit"]} aria-hidden="true">
          <Logo compact mark="large" />
          <span className={styles["welcome-orbit__ring"]} />
          <span className={styles["welcome-orbit__ring"]} />
        </div>
      )}
      <h1>What should we work on?</h1>
      {setup ? (
        <>
          <p>First, connect the AI model Zhiyin works through.</p>
          <div className={styles["new-view__setup"]}>{setup}</div>
        </>
      ) : offered.length > 0 ? (
        <>
          <p>Ask anything, or start from what your plugins can do.</p>
          {!disabled && (
            <ul className={styles.starters} aria-label="Ways to begin">
              {offered.map((starter) => (
                <li key={starter.plugin}>
                  <button
                    type="button"
                    onClick={() => onSuggestion(starter.prompt)}
                  >
                    <small>{starter.plugin}</small>
                    <span>{starter.prompt}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p>
            A thought, a question, a possibility.
            <br />
            Let’s make something of it.
          </p>
          {!disabled && (
            <div className={styles["prompt-suggestions"]}>
              {general.map((suggestion) => (
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
        </>
      )}
    </div>
  );
}
