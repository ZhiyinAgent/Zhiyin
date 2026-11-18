import { listed } from "../shared/index.js";
import styles from "./model.module.css";

/**
 * The foot of the Model page while the choice differs from what is stored:
 * what would be used, in a sentence, beside Discard and Save. A save that
 * failed says so in the same place.
 */
export function SaveBar({
  failure,
  modelName,
  providerName,
  upstreams,
  saving,
  unsavable,
  onDiscard,
  onSave,
}: {
  failure: string | null;
  /** The model chosen, by name; absent until one is. */
  modelName: string | undefined;
  providerName: string | undefined;
  /** Who may run it, by name, where the person narrowed that. */
  upstreams: readonly string[];
  saving: boolean;
  /** Why the choice cannot be saved as it is, said on the Save button. */
  unsavable: string | undefined;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const runBy = [...new Set(upstreams)];
  return (
    <div
      className={styles["model-save-bar"]}
      role="group"
      aria-label="Not saved yet"
    >
      <p>
        {failure ? (
          <span role="alert">{failure}</span>
        ) : modelName ? (
          <>
            Use <strong>{modelName}</strong>
            {providerName && (
              <>
                {" "}
                on <strong>{providerName}</strong>
              </>
            )}
            {runBy.length > 0 && <>, run by {listed(runBy, "or")}</>}?
          </>
        ) : (
          <>Choose a model on {providerName ?? "this provider"} to use it.</>
        )}
      </p>
      <button
        className="button"
        type="button"
        disabled={saving}
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
    </div>
  );
}
