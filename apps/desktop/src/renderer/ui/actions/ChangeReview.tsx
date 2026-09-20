import type { FileChange } from "@zhiyin/contract";
import { diffLines } from "./diff.js";
import styles from "./actions.module.css";

/**
 * One file's change, as a difference.
 *
 * Shared, because the question is the same before and after: a person deciding
 * whether to allow a change and a person checking what was done are looking
 * for the same thing, and showing them two different renderings of it would
 * make the second harder than the first for no reason.
 */
export function ChangeReview({
  change,
  omittedNote,
}: {
  change: FileChange;
  /** What it means here that the change cannot be shown. */
  omittedNote: string;
}) {
  if (change.omitted !== undefined || change.after === undefined) {
    return (
      <div className={styles["change-review__unavailable"]} role="status">
        <p>{change.omitted ?? "This change cannot be shown here."}</p>
        <p>{omittedNote}</p>
      </div>
    );
  }
  const summary = diffLines(change.before ?? "", change.after);
  return (
    <>
      <p className={styles["change-review__summary"]}>
        <span className={styles["change-review__path"]}>{change.path}</span>
        <span
          className={`${styles["change-review__count"]} ${styles["change-review__count--added"]}`}
        >
          +{summary.added}
        </span>
        <span
          className={`${styles["change-review__count"]} ${styles["change-review__count--removed"]}`}
        >
          −{summary.removed}
        </span>
        <span>
          {change.change === "created"
            ? "New file"
            : "Replaces the file already there"}
        </span>
      </p>
      <table className={styles.diff}>
        <caption className={styles["visually-hidden"]}>
          Line by line difference for {change.path}
        </caption>
        <tbody>
          {summary.sections.map((section, index) =>
            section.kind === "skipped" ? (
              <tr className={styles.diff__skip} key={`skip-${index}`}>
                <td colSpan={3}>{section.count} unchanged lines</td>
              </tr>
            ) : (
              section.lines.map((line, lineIndex) => (
                <tr
                  className={`${styles.diff__row} ${styles[`diff__row--${line.kind}`]}`}
                  key={`${index}-${lineIndex}`}
                >
                  <td className={styles.diff__number}>
                    {line.beforeLine ?? ""}
                  </td>
                  <td className={styles.diff__number}>
                    {line.afterLine ?? ""}
                  </td>
                  <td className={styles.diff__text}>
                    <span className={styles.diff__marker} aria-hidden="true">
                      {line.kind === "added"
                        ? "+"
                        : line.kind === "removed"
                          ? "−"
                          : " "}
                    </span>
                    {/* Named for a reader who cannot see the colour. */}
                    <span className={styles["visually-hidden"]}>
                      {line.kind === "added"
                        ? "Added: "
                        : line.kind === "removed"
                          ? "Removed: "
                          : "Unchanged: "}
                    </span>
                    <code>{line.text || " "}</code>
                  </td>
                </tr>
              ))
            ),
          )}
        </tbody>
      </table>
    </>
  );
}
