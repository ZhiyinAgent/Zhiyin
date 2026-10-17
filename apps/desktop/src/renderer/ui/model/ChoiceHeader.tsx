import { CloseButton } from "../shared/index.js";
import styles from "./model.module.css";

/**
 * The page's heading, with what can be done about the draft: whether it is
 * saved yet or why saving it failed, Discard, Save, and closing the page.
 */
export function ChoiceHeader({
  dirty,
  saving,
  failure,
  unsavable,
  onDiscard,
  onSave,
  onClose,
}: {
  /** The draft differs from what is stored. */
  dirty: boolean;
  saving: boolean;
  failure: string | null;
  /** Why the draft cannot be saved as it is, said on the Save button. */
  unsavable: string | undefined;
  onDiscard: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <header className={styles["model-settings__head"]}>
      <div>
        <p className="instrument-label">Your preferences / Model</p>
        <h1 tabIndex={-1}>Model</h1>
      </div>
      <div className={styles["model-settings__actions"]}>
        {failure && (
          <span className={styles["model-settings__failed"]} role="alert">
            {failure}
          </span>
        )}
        {dirty && !failure && (
          <span className={styles["model-settings__dirty"]}>Not saved yet</span>
        )}
        <button
          className="button"
          type="button"
          disabled={!dirty || saving}
          data-tip={!dirty ? "Nothing has changed yet" : undefined}
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          className="button button--accent"
          type="button"
          disabled={unsavable !== undefined || saving}
          data-tip={unsavable}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <CloseButton label="Close settings" onClick={onClose} />
      </div>
    </header>
  );
}
