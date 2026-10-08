import { useEffect, useState } from "react";
import type { DocumentComparison } from "@zhiyin/contract";
import { diffLines, type DiffLine } from "@zhiyin/contract";
import { ChangeSummary, DiffTable } from "./ChangeReview.js";
import styles from "./actions.module.css";

type Loaded =
  | { readonly status: "reading" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "read"; readonly comparison: DocumentComparison };

/**
 * What a turn changed in a PDF, as the words on its pages before and after,
 * read when the person asks to see it.
 *
 * Only the words are compared. A change to layout, pictures or fonts alone
 * shows no difference here, and the review says so rather than reading as
 * "nothing changed".
 */
export function DocumentChangeReview({
  path,
  compare,
}: {
  path: string;
  compare: (path: string) => Promise<DocumentComparison>;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "reading" });

  useEffect(() => {
    let current = true;
    compare(path).then(
      (comparison) => {
        if (current) setLoaded({ status: "read", comparison });
      },
      (cause: unknown) => {
        if (current)
          setLoaded({
            status: "failed",
            reason:
              cause instanceof Error
                ? cause.message
                : `What changed in ${path} could not be read.`,
          });
      },
    );
    return () => {
      current = false;
    };
  }, [compare, path]);

  if (loaded.status !== "read")
    return (
      <div className={styles["change-review__unavailable"]} role="status">
        <p>
          {loaded.status === "reading"
            ? `Reading both versions of ${path}…`
            : loaded.reason}
        </p>
      </div>
    );

  const before = linesOf(loaded.comparison.before ?? []);
  const after = linesOf(loaded.comparison.after);
  const summary = diffLines(before.text, after.text);
  const pageOf = (line: DiffLine) =>
    line.afterLine !== undefined
      ? after.pages[line.afterLine - 1]!
      : before.pages[line.beforeLine! - 1]!;
  const changedPages = [
    ...new Set(
      summary.sections.flatMap((section) =>
        section.kind === "lines"
          ? section.lines
              .filter((line) => line.kind !== "same")
              .map((line) => pageOf(line))
          : [],
      ),
    ),
  ].sort((left, right) => left - right);

  if (!changedPages.length)
    return (
      <div className={styles["change-review__unavailable"]} role="status">
        <p>
          {loaded.comparison.before
            ? "The words are the same in both versions. Anything else that changed, such as its layout, pictures or fonts, is not compared here."
            : `${path} is new, and has no words to show.`}
        </p>
      </div>
    );
  return (
    <>
      <ChangeSummary
        path={path}
        summary={summary}
        note={
          loaded.comparison.before
            ? `Words changed on ${pagesNamed(changedPages)}`
            : "New document"
        }
      />
      <DiffTable
        summary={summary}
        caption={`Words changed in ${path}, page by page`}
        pageOf={pageOf}
      />
    </>
  );
}

/** The pages' words as one text, with the page each of its lines is on. */
function linesOf(pages: readonly string[]): {
  readonly text: string;
  readonly pages: readonly number[];
} {
  const lines: string[] = [];
  const pageOfLine: number[] = [];
  pages.forEach((page, index) => {
    for (const line of page.split(/\r?\n/).filter((text) => text.trim())) {
      lines.push(line);
      pageOfLine.push(index + 1);
    }
  });
  return { text: lines.join("\n"), pages: pageOfLine };
}

function pagesNamed(pages: readonly number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`;
  if (pages.length > 6) return `${pages.length} pages`;
  return `pages ${pages.slice(0, -1).join(", ")} and ${pages.at(-1)}`;
}
