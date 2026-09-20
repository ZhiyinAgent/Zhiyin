import { useState } from "react";
import type { HistoryRecovery } from "@zhiyin/contract";
import { Icon, StandalonePage } from "../shared/index.js";
import styles from "./recovery.module.css";

/**
 * The screen a person meets when their saved conversations will not open.
 *
 * It exists so the answer is theirs. The damaged file has already been kept
 * aside by the time this is shown, so neither choice destroys anything, and
 * nothing at all happens until one of them is made. It never asks anybody to
 * find or repair a file.
 */
export function HistoryRecoveryGate({
  recovery,
  onChoose,
}: {
  recovery: HistoryRecovery;
  onChoose: (choice: "recover" | "startFresh") => Promise<void>;
}) {
  const [working, setWorking] = useState<"recover" | "startFresh" | "">("");
  const [error, setError] = useState("");

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
      tagline="Nothing has been deleted."
      label="SAVED CONVERSATIONS"
      title={
        <>
          Some of your history
          <br />
          could not be opened.
        </>
      }
      introduction={
        recovery.readable > 0
          ? `${countOf(recovery.readable, "conversation")} can still be opened, and ${countOf(recovery.damaged, "conversation")} cannot. Nothing has been changed yet — a copy of the original is already kept safely aside.`
          : "None of the saved conversations could be read. A copy of the original is already kept safely aside, so nothing has been lost that was not already damaged."
      }
      note="You can hand the kept copy to someone who can look at it later."
      actions={
        <div className={styles["recovery-choices"]}>
          {recovery.readable > 0 && (
            <button
              type="button"
              className="button button--accent"
              disabled={Boolean(working)}
              onClick={() => void choose("recover")}
            >
              {working === "recover"
                ? "Restoring…"
                : `Open the ${countOf(recovery.readable, "conversation")}`}
              <Icon name="arrow-up" />
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={Boolean(working)}
            onClick={() => void choose("startFresh")}
          >
            {working === "startFresh"
              ? "Starting…"
              : "Start with a clean slate"}
          </button>
        </div>
      }
      {...(error ? { error } : {})}
    />
  );
}

function countOf(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
