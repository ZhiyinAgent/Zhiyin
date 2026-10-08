import { useId, useState } from "react";
import type { HistoryRecovery } from "@zhiyin/contract";
import { Icon, StandalonePage } from "../shared/index.js";
import styles from "./recovery.module.css";

/**
 * The screen a person meets when their saved conversations will not open.
 *
 * It exists so the answer is theirs. The damaged file has already been kept
 * aside by the time this is shown, so neither choice destroys anything, and
 * nothing at all happens until one of them is made. It never asks anybody to
 * find or repair a file. Each choice says what it does with the conversations.
 */
export function HistoryRecoveryGate({
  recovery,
  onChoose,
  onShowKept,
}: {
  recovery: HistoryRecovery;
  onChoose: (choice: "recover" | "startFresh") => Promise<void>;
  /** Shows the kept copy selected in its folder. */
  onShowKept?: (path: string) => void;
}) {
  const [working, setWorking] = useState<"recover" | "startFresh" | "">("");
  const [error, setError] = useState("");
  const total = recovery.readable + recovery.damaged;

  async function choose(choice: "recover" | "startFresh") {
    if (working) return;
    setWorking(choice);
    setError("");
    try {
      await onChoose(choice);
    } catch {
      setError(
        "That could not be completed. Your saved conversations have not been changed.",
      );
      setWorking("");
    }
  }

  return (
    <StandalonePage
      layout="split"
      label="SAVED CONVERSATIONS"
      title="Some of your history could not be opened."
      introduction={
        recovery.readable > 0
          ? `${countOf(recovery.readable, "conversation")} can still be opened, and ${countOf(recovery.damaged, "conversation")} cannot. Nothing has been changed yet — a copy of the original is already kept safely aside.`
          : "None of the saved conversations could be read. A copy of the original is already kept safely aside, so nothing has been lost that was not already damaged."
      }
      note={
        <>
          <p>Someone can look at the kept copy later.</p>
          {onShowKept && (
            <button
              type="button"
              className="button button--small"
              onClick={() => onShowKept(recovery.keptAt)}
            >
              Show the kept copy
            </button>
          )}
        </>
      }
      {...(error ? { error } : {})}
    >
      <div className={styles["recovery-choices"]}>
        {recovery.readable > 0 && (
          <Choice
            primary
            icon="check"
            title={
              working === "recover"
                ? "Restoring…"
                : `Open the ${countOf(recovery.readable, "conversation")}`
            }
            detail={
              recovery.damaged > 0
                ? `The ${recovery.damaged} that cannot be read stay in the kept copy.`
                : "They open as they were."
            }
            disabled={Boolean(working)}
            onChoose={() => void choose("recover")}
          />
        )}
        <Choice
          icon="file"
          title={
            working === "startFresh" ? "Starting…" : "Start with a clean slate"
          }
          detail={
            total > 0
              ? `Zhiyin opens empty. All ${total} stay in the kept copy, but Zhiyin will not show them.`
              : "Zhiyin opens empty. The saved history stays in the kept copy."
          }
          disabled={Boolean(working)}
          onChoose={() => void choose("startFresh")}
        />
      </div>
    </StandalonePage>
  );
}

/** One answer, as a card: what it is, and what it does with the conversations. */
function Choice({
  icon,
  title,
  detail,
  primary = false,
  disabled,
  onChoose,
}: {
  icon: "check" | "file";
  title: string;
  detail: string;
  primary?: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const detailId = useId();
  return (
    <button
      type="button"
      className={`${styles["recovery-choice"]}${primary ? ` ${styles["recovery-choice--primary"]}` : ""}`}
      aria-label={title}
      aria-describedby={detailId}
      disabled={disabled}
      onClick={onChoose}
    >
      <Icon name={icon} />
      <strong>{title}</strong>
      <span id={detailId}>{detail}</span>
      <span className={styles["recovery-choice__go"]} aria-hidden="true">
        <Icon name="arrow-up" />
      </span>
    </button>
  );
}

function countOf(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
