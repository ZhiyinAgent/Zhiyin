import { useState } from "react";
import type { DocumentComparison, FileChange } from "@zhiyin/contract";
import { ChangeReview } from "./ChangeReview.js";
import { CodeReview } from "./CodeReview.js";
import { DocumentChangeReview } from "./DocumentChangeReview.js";
import {
  counted,
  Dialog,
  Icon,
  moveAmongTabs,
  visibleText,
} from "../../shared/index.js";
import { recordLook } from "../recordLook.js";
import styles from "./change-review.module.css";

/**
 * What a change would actually do, shown as a difference rather than as the
 * call that would produce it.
 *
 * It is a modal because reviewing a change is the whole task while it is
 * happening: the reader should be able to scroll a long diff without losing
 * the request underneath, and should leave the same way they arrived. Focus is
 * moved in and returned on close, and Escape closes it, because the person
 * doing this may be doing it with a keyboard and cannot be stranded here.
 *
 * A change the tool could not carry says so in place of a diff. Showing
 * nothing at all would let an approval look reviewed when it was not.
 *
 * Code a request runs, when it is too long for the card, is reviewed here
 * too, ahead of the files it changes: it is what makes them.
 */
export function DiffModal({
  changes,
  code,
  initialPath,
  about,
  compareDocument,
  onClose,
}: {
  changes: readonly FileChange[];
  /** The code the request runs, shown whole as the first tab. */
  code?: string | undefined;
  /** What asked for the change, said under the heading. */
  about?: string;
  /** The file to open on; the code, or else the first file, otherwise. */
  initialPath?: string | undefined;
  /**
   * Reads what was done to a PDF, once it is done: a PDF's contents are not
   * carried with its change, so they are compared from the file and the copy
   * kept before it.
   */
  compareDocument?: ((path: string) => Promise<DocumentComparison>) | undefined;
  onClose: () => void;
}) {
  const tabs = [
    ...(code === undefined ? [] : [{ key: codeTab, label: "Code that runs" }]),
    ...changes.map((change) => ({ key: change.path, label: change.path })),
  ];
  const [openPath, setOpenPath] = useState(initialPath ?? tabs[0]?.key);
  const current = changes.find((change) => change.path === openPath);

  return (
    <Dialog
      title={heading(code !== undefined, changes.length)}
      look={recordLook}
      heading={(title) => (
        <div className={styles["diff-modal__title"]}>
          {title}
          {about && <p>{visibleText(about)}</p>}
        </div>
      )}
      tabs={
        tabs.length > 1
          ? (panelId) => (
              <div
                className={styles["diff-modal__files"]}
                role="tablist"
                aria-label={
                  code === undefined
                    ? "Changed files"
                    : "Code and changed files"
                }
                onKeyDown={moveAmongTabs}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={tab.key === openPath}
                    aria-controls={panelId}
                    tabIndex={tab.key === openPath ? 0 : -1}
                    onClick={() => setOpenPath(tab.key)}
                  >
                    <Icon name={tab.key === codeTab ? "code" : "file"} />
                    <span>{visibleText(tab.label)}</span>
                  </button>
                ))}
              </div>
            )
          : undefined
      }
      onClose={onClose}
    >
      {openPath === codeTab && code !== undefined && <CodeReview code={code} />}
      {current &&
        (compareDocument && comparable(current) ? (
          <DocumentChangeReview
            key={current.path}
            path={current.path}
            compare={compareDocument}
          />
        ) : (
          <ChangeReview
            change={current}
            omittedNote="Approving it means approving a change you have not seen in full."
          />
        ))}
    </Dialog>
  );
}

/** The code's tab: no file's path is empty. */
export const codeTab = "";

function heading(hasCode: boolean, files: number): string {
  const changes = counted(files, "change");
  if (hasCode)
    return files
      ? `Review the code and ${changes}`
      : "Review the code that runs";
  return files === 1 ? "Review this change" : `Review ${changes}`;
}

/**
 * A PDF created or rewritten, whose words can be compared once it is. One
 * moved here has nothing at its new path to be compared with, so it is not.
 */
export function comparable(change: FileChange): boolean {
  return (
    /\.pdf$/i.test(change.path) &&
    change.from === undefined &&
    (change.change === "created" || change.change === "updated")
  );
}
