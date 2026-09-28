import {
  standingInstructionBytes,
  type StandingInstruction,
} from "@zhiyin/contract";
import styles from "./conversation.module.css";

function size(bytes: number): string {
  return bytes < 1_024 ? `${bytes} bytes` : `${Math.ceil(bytes / 1_024)} KB`;
}

/**
 * The standing instructions the conversation's last turn sent (ADR 0054):
 * each source with its size, whether it was shortened, the exact text, and
 * where to change it.
 */
export function InstructionSources({
  sources,
  onEdit,
}: {
  sources: readonly StandingInstruction[];
  onEdit?: () => void;
}) {
  return (
    <div className={styles["instruction-sources"]}>
      <h3>Standing instructions</h3>
      {sources.map((source) => {
        const name =
          source.source === "personal"
            ? "Your instructions"
            : `${source.path} in the folder`;
        return (
          <section
            key={name}
            role="group"
            aria-label={name}
            className={styles["instruction-sources__source"]}
          >
            <p className={styles["instruction-sources__head"]}>
              <strong>{name}</strong>
              <span>{size(source.bytes)}</span>
            </p>
            {source.truncated && (
              <p className={styles["instruction-sources__note"]}>
                Shortened to the first {size(standingInstructionBytes)}.
              </p>
            )}
            <details>
              <summary>Exact text sent</summary>
              <pre>{source.text}</pre>
            </details>
            {source.source === "personal" ? (
              onEdit && (
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={onEdit}
                >
                  Edit custom instructions
                </button>
              )
            ) : (
              <p className={styles["instruction-sources__note"]}>
                Edit {source.path} in the folder to change these.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
