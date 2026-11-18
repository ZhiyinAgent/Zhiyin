import { useId, useState } from "react";
import { lookIds, type LookChoice, type LookId } from "@zhiyin/contract";
import { Icon, StandalonePage, lookWords } from "../shared/index.js";
import { LookMiniature } from "./LookMiniature.js";
import styles from "./onboarding.module.css";

/**
 * Onboarding's last step: one card per listed look, each a small window
 * wearing it. Choosing one dresses the window at once, through the same
 * command Settings uses, and keeps the strength as it is.
 */
export function LookStep({
  look,
  onLook,
  onBack,
  onStart,
  starting,
  error: startError,
  label = "STEP 2 OF 2",
}: {
  /** Where the step stands among onboarding's steps. */
  label?: string;
  look: LookChoice;
  onLook: (choice: LookChoice) => Promise<void>;
  onBack: () => void;
  onStart: () => void;
  starting: boolean;
  error: string;
}) {
  const group = useId();
  const [chosen, setChosen] = useState<LookId>(look.look);
  const [error, setError] = useState("");
  async function choose(id: LookId) {
    const before = chosen;
    setChosen(id);
    setError("");
    try {
      await onLook({ look: id, strength: look.strength });
    } catch {
      setChosen(before);
      setError("The look could not be changed. Try again.");
    }
  }
  const shown = startError || error;
  return (
    <StandalonePage
      tagline="A little more you."
      label={label}
      title="How should Zhiyin look?"
      introduction="A look dresses the whole window. You can change it, and how strongly its pictures show, in Settings."
      actions={
        <span className={styles["look-step__actions"]}>
          <button
            type="button"
            className="button button--quiet"
            disabled={starting}
            onClick={onBack}
          >
            Back
          </button>
          <button
            type="button"
            className="button button--accent"
            disabled={starting}
            onClick={onStart}
          >
            {starting ? "Getting ready…" : "Start exploring"}
            <Icon name="arrow-up" />
          </button>
        </span>
      }
      error={shown}
    >
      <div
        className={styles["look-choices"]}
        role="radiogroup"
        aria-label="Look"
      >
        {lookIds.map((id) => (
          <label key={id} className={styles["look-card"]}>
            <input
              type="radio"
              name={group}
              value={id}
              checked={chosen === id}
              disabled={starting}
              onChange={() => void choose(id)}
            />
            <LookMiniature look={id} strength={look.strength} />
            <strong>{lookWords[id].name}</strong>
            <span>{lookWords[id].description}</span>
          </label>
        ))}
      </div>
    </StandalonePage>
  );
}
