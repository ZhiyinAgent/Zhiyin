import { useState } from "react";
import type { AppUpdateState } from "@zhiyin/contract";
import styles from "./sidebar.module.css";

/**
 * Said at the foot of the sidebar once an update is downloaded and checked
 * (ADR 0027): which version, and the button that restarts into it. The core
 * may refuse, as while a conversation is working, and its reason is shown
 * under the button.
 */
export function UpdateReady({
  update,
  onRestart,
}: {
  update: AppUpdateState;
  onRestart: () => Promise<void>;
}) {
  const [refusal, setRefusal] = useState("");
  const { phase } = update;
  if (phase.kind !== "ready" && phase.kind !== "restarting") return null;
  const restarting = phase.kind === "restarting";
  return (
    <div className={styles["update-ready"]} role="status">
      <p className={styles["update-ready__text"]}>
        Zhiyin {phase.version} is ready
      </p>
      <button
        type="button"
        className="button"
        disabled={restarting}
        onClick={() => {
          setRefusal("");
          onRestart().catch((cause: unknown) =>
            setRefusal(
              cause instanceof Error
                ? cause.message
                : "Zhiyin could not restart. Try again.",
            ),
          );
        }}
      >
        {restarting ? "Restarting…" : "Restart to update"}
      </button>
      {refusal && (
        <p className={styles["update-ready__refusal"]} role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
