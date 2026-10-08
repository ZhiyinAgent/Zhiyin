import { useState } from "react";
import type { ArtifactExport, ConversationFormat } from "@zhiyin/contract";
import { Dialog, Icon, PathName } from "../shared/index.js";
import styles from "./app.module.css";

const formats = [
  {
    value: "html",
    label: "A page to read",
    tag: "HTML",
    detail:
      "Opens in any browser, even offline: the messages, each action and who allowed it, file changes, cost and model.",
  },
  {
    value: "json",
    label: "Data to analyse",
    tag: "JSON",
    detail:
      "The conversation as Zhiyin keeps it, model requests and responses included, for a program or another model.",
  },
] as const;

type Progress =
  | { readonly status: "choosing" }
  | { readonly status: "exporting" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "saved"; readonly destination: string };

/**
 * Asks what to make of a conversation, a page to read or data to analyse,
 * saying what each holds; then where the file went.
 */
export function ExportConversationDialog({
  title,
  onExport,
  onShowInFolder,
  onClose,
}: {
  title: string;
  onExport: (format: ConversationFormat) => Promise<ArtifactExport>;
  onShowInFolder?: ((path: string) => void) | undefined;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ConversationFormat>("html");
  const [progress, setProgress] = useState<Progress>({ status: "choosing" });
  const exporting = progress.status === "exporting";

  const exportChosen = async () => {
    setProgress({ status: "exporting" });
    try {
      const outcome = await onExport(format);
      setProgress(
        outcome.status === "cancelled" ? { status: "choosing" } : outcome,
      );
    } catch {
      setProgress({
        status: "failed",
        reason: "The conversation could not be exported. Try again.",
      });
    }
  };

  if (progress.status === "saved") {
    const destination = progress.destination;
    return (
      <Dialog
        title="Export conversation"
        onClose={onClose}
        footer={
          <>
            {onShowInFolder && (
              <button
                type="button"
                className="button"
                onClick={() => onShowInFolder(destination)}
              >
                Show in folder
              </button>
            )}
            <button
              type="button"
              className="button button--accent"
              onClick={onClose}
            >
              Done
            </button>
          </>
        }
      >
        <div className={styles["export-saved"]} role="status">
          <span className={styles["export-saved__mark"]} aria-hidden="true">
            <Icon name="check" />
          </span>
          <div className={styles["export-saved__text"]}>
            <strong>Saved</strong>
            <PathName
              path={destination}
              className={styles["export-saved__path"]}
            />
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Export conversation"
      onClose={onClose}
      footer={
        <>
          <p className={styles["export-dialog__note"]}>
            Keys and passwords Zhiyin recognises are left out of both.
          </p>
          <button
            type="button"
            className="button button--accent"
            disabled={exporting}
            onClick={() => void exportChosen()}
          >
            {exporting ? "Exporting…" : "Export…"}
          </button>
        </>
      }
    >
      <p className={styles["export-dialog__subject"]}>{title}</p>
      <div
        role="radiogroup"
        aria-label="What to make of it"
        className={styles["export-formats"]}
      >
        {formats.map((choice) => (
          <label key={choice.value} className={styles["export-format"]}>
            <input
              type="radio"
              name="export-format"
              value={choice.value}
              checked={format === choice.value}
              disabled={exporting}
              onChange={() => setFormat(choice.value)}
            />
            <FormatPreview format={choice.value} />
            <span className={styles["export-format__heading"]}>
              <span className={styles["export-format__label"]}>
                {choice.label}
              </span>
              <span className={styles["export-format__tag"]}>{choice.tag}</span>
            </span>
            <span className={styles["export-format__detail"]}>
              {choice.detail}
            </span>
          </label>
        ))}
      </div>
      {progress.status === "failed" && (
        <p className={styles["export-dialog__error"]} role="alert">
          {progress.reason}
        </p>
      )}
    </Dialog>
  );
}

/** A miniature of the file each choice makes: a page, or a record. */
function FormatPreview({ format }: { format: ConversationFormat }) {
  if (format === "html")
    return (
      <span
        className={`${styles["export-format__preview"]} ${styles["export-page"]}`}
        aria-hidden="true"
      >
        <span className={styles["export-page__sheet"]}>
          <i className={styles["export-page__title"]} />
          <i className={styles["export-page__ask"]} />
          <i className={styles["export-page__line"]} />
          <i className={styles["export-page__line--short"]} />
          <i className={styles["export-page__action"]} />
        </span>
      </span>
    );
  return (
    <span
      className={`${styles["export-format__preview"]} ${styles["export-data"]}`}
      aria-hidden="true"
    >
      <code>
        <span className={styles["export-data__punct"]}>{"{"}</span>
        {"\n  "}
        <span className={styles["export-data__key"]}>"app"</span>
        <span className={styles["export-data__punct"]}>: {"{ … },"}</span>
        {"\n  "}
        <span className={styles["export-data__key"]}>"notes"</span>
        <span className={styles["export-data__punct"]}>: [ … ],</span>
        {"\n  "}
        <span className={styles["export-data__key"]}>"conversation"</span>
        <span className={styles["export-data__punct"]}>: {"{ … }"}</span>
        {"\n"}
        <span className={styles["export-data__punct"]}>{"}"}</span>
      </code>
    </span>
  );
}
