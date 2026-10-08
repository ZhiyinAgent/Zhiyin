import { useState } from "react";
import type { SavedConversationsOutcome } from "@zhiyin/contract";
import { Dialog } from "../shared/index.js";
import styles from "./recovery.module.css";

type Step =
  | { readonly kind: "asking"; readonly failure?: string }
  | { readonly kind: "confirmingDelete" }
  | { readonly kind: "working"; readonly choice: "update" | "recycle" }
  | {
      readonly kind: "settled";
      readonly choice: "update" | "recycle";
      readonly outcome: SavedConversationsOutcome;
    };

/**
 * The question about conversations an earlier version saved: update them now,
 * later, or delete them. It is asked at launch, and again whenever the person
 * opens one of them or asks from Settings, until none is left.
 *
 * Updating keeps each conversation as it was until its updated copy has been
 * checked, so the dialog can say plainly that one that failed is unchanged.
 * Deleting moves them to the Recycle Bin, and only after a second answer that
 * names how many. ADR 0022.
 */
export function SavedConversationsUpdate({
  waiting,
  onSettle,
  onClose,
}: {
  waiting: readonly { readonly title: string; readonly writtenBy: string }[];
  onSettle: (
    choice: "update" | "recycle",
  ) => Promise<SavedConversationsOutcome>;
  /** Later, or done. */
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "asking" });
  const one = waiting.length === 1;
  const versions = [...new Set(waiting.map((item) => item.writtenBy))];
  const working = step.kind === "working";

  async function settle(choice: "update" | "recycle") {
    if (working) return;
    setStep({ kind: "working", choice });
    try {
      const outcome = await onSettle(choice);
      if (outcome.failed === 0) onClose();
      else setStep({ kind: "settled", choice, outcome });
    } catch {
      setStep({
        kind: "asking",
        failure:
          "That could not be done. Your saved conversations have not been changed.",
      });
    }
  }

  const close = () => {
    if (!working) onClose();
  };

  if (step.kind === "settled")
    return (
      <Dialog
        title="Saved conversations"
        onClose={onClose}
        footer={
          <button
            type="button"
            className="button button--accent"
            onClick={onClose}
          >
            Done
          </button>
        }
      >
        <p className={styles["update-dialog__text"]} role="status">
          {settledText(step.choice, step.outcome)}
        </p>
      </Dialog>
    );

  if (step.kind === "confirmingDelete")
    return (
      <Dialog
        title="Delete saved conversations"
        onClose={close}
        footer={
          <>
            <button
              type="button"
              className="button"
              onClick={() => setStep({ kind: "asking" })}
            >
              Back
            </button>
            <button
              type="button"
              className={`button ${styles["update-dialog__delete"]}`}
              onClick={() => void settle("recycle")}
            >
              Move to the Recycle Bin
            </button>
          </>
        }
      >
        <p className={styles["update-dialog__text"]}>
          <strong>
            Move{" "}
            {one ? `“${waiting[0]!.title}”` : `${waiting.length} conversations`}{" "}
            to the Recycle Bin?
          </strong>
        </p>
        <p className={styles["update-dialog__text"]}>
          {one ? "It can be restored" : "They can be restored"} from there.
          Pictures, pasted texts and saved outputs kept with{" "}
          {one ? "it" : "them"} are deleted.
        </p>
      </Dialog>
    );

  return (
    <Dialog
      title="Update saved conversations"
      onClose={close}
      footer={
        <>
          <button
            type="button"
            className={`button ${styles["update-dialog__later"]}`}
            disabled={working}
            onClick={close}
          >
            Later
          </button>
          <button
            type="button"
            className="button"
            disabled={working}
            onClick={() => setStep({ kind: "confirmingDelete" })}
          >
            {working && step.choice === "recycle"
              ? "Moving…"
              : one
                ? "Delete it…"
                : "Delete them…"}
          </button>
          <button
            type="button"
            className="button button--accent"
            disabled={working}
            onClick={() => void settle("update")}
          >
            {working && step.choice === "update"
              ? "Updating…"
              : one
                ? "Update it"
                : "Update them"}
          </button>
        </>
      }
    >
      <p className={styles["update-dialog__text"]}>
        {one
          ? `“${waiting[0]!.title}” was saved`
          : `${waiting.length} conversations were saved`}{" "}
        by an earlier version of Zhiyin ({versions.join(", ")}).{" "}
        {one ? "It needs" : "They need"} an update before{" "}
        {one ? "it opens" : "they open"} in this one.
      </p>
      <p className={styles["update-dialog__text"]}>
        Nothing is lost: one that cannot be updated is left as it was.
      </p>
      {step.kind === "asking" && step.failure && (
        <p className={styles["update-dialog__failure"]} role="alert">
          {step.failure}
        </p>
      )}
    </Dialog>
  );
}

function settledText(
  choice: "update" | "recycle",
  { done, failed }: SavedConversationsOutcome,
): string {
  const did =
    done === 0
      ? "None was"
      : done === 1
        ? "One conversation was"
        : `${done} conversations were`;
  const left =
    failed === 1
      ? "One could not be, and was left as it was."
      : `${failed} could not be, and were left as they were.`;
  return `${did} ${choice === "update" ? "updated" : "moved to the Recycle Bin"}. ${left}`;
}
