import { useId, useState } from "react";
import { standingInstructionBytes, utf8Bytes } from "@zhiyin/contract";
import styles from "./instructions.module.css";

function size(bytes: number): string {
  return bytes < 1_024 ? `${bytes} bytes` : `${Math.ceil(bytes / 1_024)} KB`;
}

/**
 * The person's own standing instructions (ADR 0054), sent with the next
 * message of every conversation. Saved as written; the loop trims them and
 * sends at most the first 16 KB, which the counter says before it happens.
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
  const bytes = utf8Bytes(text.trim());
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
          {size(bytes)} of {size(standingInstructionBytes)}
        </span>
        {bytes > standingInstructionBytes && (
          <span className={styles["personal-instructions__over"]}>
            Only the first {size(standingInstructionBytes)} will be sent.
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
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save instructions"}
        </button>
      </div>
    </section>
  );
}
