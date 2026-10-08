import type { ReactNode } from "react";
import type { FileChange } from "@zhiyin/contract";
import { diffLines, type DiffLine, type DiffSummary } from "@zhiyin/contract";
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
  if (change.change === "recycled" || change.change === "deleted")
    return (
      <div className={styles["change-review__unavailable"]} role="status">
        <p>
          {change.change === "recycled"
            ? `${change.path} goes to the Recycle Bin, where it can be restored.`
            : `${change.path} is deleted permanently. It cannot be restored from the Recycle Bin.`}
        </p>
      </div>
    );
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
      <ChangeSummary
        path={change.path}
        summary={summary}
        note={
          change.change === "created"
            ? "New file"
            : "Replaces the file already there"
        }
      />
      <DiffTable
        summary={summary}
        caption={`Line by line difference for ${change.path}`}
      />
    </>
  );
}

/** The file, how many lines arrive and go, and a word on what the change is. */
export function ChangeSummary({
  path,
  summary,
  note,
}: {
  path: string;
  summary: DiffSummary;
  note: string;
}) {
  return (
    <p className={styles["change-review__summary"]}>
      <span className={styles["change-review__path"]}>{path}</span>
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
      <span>{note}</span>
    </p>
  );
}

/**
 * A difference, line by line. Given the page each line is on, as a PDF's
 * lines are, it names the page wherever the lines shown move onto another one,
 * and numbers no line: a line number in a document's extracted words points
 * nowhere a reader can look.
 */
export function DiffTable({
  summary,
  caption,
  pageOf,
}: {
  summary: DiffSummary;
  caption: string;
  pageOf?: (line: DiffLine) => number;
}) {
  const columns = pageOf ? 1 : 2;
  const rows: ReactNode[] = [];
  let shownPage: number | undefined;
  summary.sections.forEach((section, index) => {
    if (section.kind === "skipped") {
      shownPage = undefined;
      rows.push(
        <tr className={styles.diff__skip} key={`skip-${index}`}>
          <td colSpan={columns}>{section.count} unchanged lines</td>
        </tr>,
      );
      return;
    }
    section.lines.forEach((line, lineIndex) => {
      const page = pageOf?.(line);
      if (page !== undefined && page !== shownPage)
        rows.push(
          <tr className={styles.diff__page} key={`page-${index}-${lineIndex}`}>
            <th colSpan={columns} scope="rowgroup">
              Page {page}
            </th>
          </tr>,
        );
      shownPage = page;
      rows.push(
        <tr
          className={`${styles.diff__row} ${styles[`diff__row--${line.kind}`]}`}
          key={`${index}-${lineIndex}`}
        >
          {/* Where the line is in the file once changed; a removed line has
              no place there. */}
          {!pageOf && (
            <td className={styles.diff__number}>{line.afterLine ?? ""}</td>
          )}
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
            <code>
              {line.parts
                ? line.parts.map((part, partIndex) =>
                    part.changed ? (
                      <mark className={styles.diff__changed} key={partIndex}>
                        {part.text}
                      </mark>
                    ) : (
                      part.text
                    ),
                  )
                : line.text || " "}
            </code>
          </td>
        </tr>,
      );
    });
  });
  return (
    <table className={styles.diff}>
      <caption className={styles["visually-hidden"]}>{caption}</caption>
      <tbody>{rows}</tbody>
    </table>
  );
}
