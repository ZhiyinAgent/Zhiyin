import type { StandingInstruction } from "@zhiyin/contract";
import { countWords, wordCount } from "../shared/index.js";
import styles from "./composer.module.css";

/**
 * The standing instructions the conversation's last turn sent (ADR 0016):
 * each source with its size in words, whether it was shortened, the exact
 * text, and where to change it.
 */
export function InstructionSources({
  sources,
  onEdit,
}: {
  sources: readonly StandingInstruction[];
  onEdit?: (() => void) | undefined;
}) {
  return (
    <div className={styles["instruction-sources"]}>
      <h3>Standing instructions</h3>
      {sources.map((source) => {
        const name = sourceName(source);
        const sent = wordCount(countWords(source.text));
        return (
          <section
            key={name}
            role="group"
            aria-label={name}
            className={styles["instruction-sources__source"]}
          >
            <p className={styles["instruction-sources__head"]}>
              <strong>{name}</strong>
              <span>{sent}</span>
            </p>
            {source.truncated && (
              <p className={styles["instruction-sources__note"]}>
                Shortened: only its first {sent} were sent.
              </p>
            )}
            <details>
              <summary>Exact text sent</summary>
              <pre>{source.text}</pre>
            </details>
            {source.source !== "folder" ? (
              onEdit && (
                <button
                  type="button"
                  className="button button--small"
                  onClick={onEdit}
                >
                  Edit in Memory
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

/** A source as the person knows it. */
function sourceName(source: StandingInstruction): string {
  switch (source.source) {
    case "about":
      return "About you";
    case "how":
      return "How to work";
    case "project":
      return `How to work in ${source.path}`;
    case "folder":
      return `${source.path} in the folder`;
  }
}
