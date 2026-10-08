import type { NewerHistory } from "@zhiyin/contract";
import { Icon, StandalonePage } from "../shared/index.js";
import styles from "./recovery.module.css";

/**
 * The page a person meets when their history was saved by a newer version of
 * Zhiyin than this one.
 *
 * Nothing in it is damaged, so nothing here offers to recover or start again:
 * the way forward is the version that saved it. This version opens none of it
 * and writes nothing to it. ADR 0022.
 */
export function NewerHistoryGate({
  newer,
  onGetLatest,
  onOpenDataFolder,
}: {
  newer: NewerHistory;
  onGetLatest?: () => void;
  onOpenDataFolder?: () => void;
}) {
  return (
    <StandalonePage
      label="SAVED CONVERSATIONS"
      title="Your history needs a newer Zhiyin."
      introduction={`It was saved by Zhiyin ${newer.writtenBy}, a newer version than this one, which cannot open it. Nothing in it has been changed. Install Zhiyin ${newer.writtenBy} or later to open it again.`}
      {...(onGetLatest || onOpenDataFolder
        ? {
            actions: (
              <div className={styles["newer-actions"]}>
                {onOpenDataFolder && (
                  <button
                    type="button"
                    className="button"
                    onClick={onOpenDataFolder}
                  >
                    Open data folder
                  </button>
                )}
                {onGetLatest && (
                  <button
                    type="button"
                    className="button button--accent"
                    onClick={onGetLatest}
                  >
                    Get the latest version
                    <Icon name="arrow-up" />
                  </button>
                )}
              </div>
            ),
          }
        : {})}
    />
  );
}
