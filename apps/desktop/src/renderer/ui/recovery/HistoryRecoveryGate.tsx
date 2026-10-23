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
  onShowKept?: (path: string) => Promise<void>;
}) {
  const [working, setWorking] = useState<"recover" | "startFresh" | "">("");
  const [error, setError] = useState("");
  const total = recovery.readable + recovery.damaged;
  const { readable, waiting, damaged } = recovery;
  const waitingText = waiting
    ? `${countOf(waiting, "conversation")} ${waiting === 1 ? "was" : "were"} saved by another version of Zhiyin and ${waiting === 1 ? "waits" : "wait"} for an update`
    : "";
  const waitingStay =
    waiting === 1
      ? "the 1 waiting for an update stays where it is."
      : `the ${waiting} waiting for an update stay where they are.`;

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
        readable > 0 || waiting > 0
          ? [
              ...(readable > 0
                ? [`${countOf(readable, "conversation")} can still be opened.`]
                : []),
              ...(waitingText ? [`${waitingText}.`] : []),
              ...(damaged > 0
                ? [`${countOf(damaged, "conversation")} cannot be read.`]
                : []),
              "Nothing has been changed yet — a copy of the original is already kept safely aside.",
            ].join(" ")
          : "None of the saved conversations could be read. A copy of the original is already kept safely aside, so nothing has been lost that was not already damaged."
      }
      note={
        <>
          <p>Someone can look at the kept copy later.</p>
          {onShowKept && (
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                setError("");
                onShowKept(recovery.keptAt).catch((cause: unknown) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "The kept copy could not be shown.",
                  ),
                );
              }}
            >
              Show the kept copy
            </button>
          )}
        </>
      }
      {...(error ? { error } : {})}
    >
      <div className={styles["recovery-choices"]}>
        {(readable > 0 || waiting > 0) && (
          <Choice
            primary
            icon="check"
            title={
              working === "recover"
                ? "Restoring…"
                : readable > 0
                  ? `Open the ${countOf(readable, "conversation")}`
                  : `Keep the ${countOf(waiting, "conversation")} waiting for an update`
            }
            detail={[
              damaged > 0
                ? damaged === 1
                  ? "The one that cannot be read stays in the kept copy."
                  : `The ${damaged} that cannot be read stay in the kept copy.`
                : readable > 0
                  ? "They open as they were."
                  : "",
              waiting > 0
                ? `${waitingStay.charAt(0).toUpperCase()}${waitingStay.slice(1)}`
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
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
            waiting > 0
              ? [
                  ...(total > 0
                    ? [
                        total === 1
                          ? "The other one stays in the kept copy, and Zhiyin will not show it."
                          : `The other ${total} stay in the kept copy, and Zhiyin will not show them.`,
                      ]
                    : []),
                  `${waitingStay.charAt(0).toUpperCase()}${waitingStay.slice(1)}`,
                ].join(" ")
              : total === 1
                ? "Zhiyin opens empty. The conversation stays in the kept copy, but Zhiyin will not show it."
                : total > 0
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
