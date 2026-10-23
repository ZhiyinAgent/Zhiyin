import { useId, useState } from "react";
import {
  estimatedTokens,
  instructionCut,
  leastInstructionTokens,
} from "@zhiyin/contract";
import { countWords, wordCount } from "../shared/index.js";
import styles from "./instructions.module.css";

/** The share of the space, which reads the same in any script. */
function share(tokens: number): string {
  const percent = (tokens / leastInstructionTokens) * 100;
  if (tokens === 0) return "";
  return percent < 1
    ? " · under 1% of the space"
    : ` · ${Math.round(percent)}% of the space`;
}

/** The words the smallest budget sends, counted from the start. */
function wordsSent(text: string): number {
  return countWords(instructionCut(text.trim(), leastInstructionTokens).text);
}

/**
 * The person's own standing instructions, sent with the next message of every
 * conversation. Saved as written; the loop trims them and sends as much as the
 * conversation's budget gives them, at least what the smallest budget does.
 * The counter measures against that least, in words and as a share of the
 * space rather than in tokens, and says before it happens when the end may be
 * left out.
 */
export function PersonalInstructions({
  saved,
  onSave,
}: {
  saved: string;
  onSave: (text: string) => Promise<void>;
}) {
  const hintId = useId();
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
  const text = draft ?? saved;
  const tokens = estimatedTokens(text.trim());
  const dirty = draft !== undefined && draft !== saved;

  async function save() {
    setSaving(true);
    setFailure(undefined);
    try {
      await onSave(text);
      setDraft(undefined);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={styles["personal-instructions"]}
      aria-labelledby={`${hintId}-title`}
    >
      <h2 id={`${hintId}-title`}>Your instructions</h2>
      <p id={hintId} className={styles["personal-instructions__hint"]}>
        Describe your preferred language, format and working habits. You can
        edit these at any time.
      </p>
      <textarea
        aria-label="Your instructions"
        aria-describedby={hintId}
        rows={7}
        placeholder="For example: Reply in French. Keep explanations concise. Ask before changing the structure of a report."
        value={text}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className={styles["personal-instructions__foot"]}>
        <span>
          {wordCount(countWords(text))}
          {share(tokens)}
        </span>
        {tokens > leastInstructionTokens && (
          <span className={styles["personal-instructions__over"]}>
            The smallest budget sends about the first{" "}
            {wordCount(wordsSent(text))}; a larger one sends more.
          </span>
        )}
        {failure && (
          <span className={styles["personal-instructions__over"]} role="alert">
            Couldn't save: {failure}
          </span>
        )}
        <button
          type="button"
          className="button button--accent"
          disabled={!dirty || saving}
          data-tip={!dirty ? "Nothing has changed yet" : undefined}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save instructions"}
        </button>
      </div>
    </section>
  );
}
