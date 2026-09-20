import { useState } from "react";
import type { CoreApi, TaskAction } from "@zhiyin/contract";
import { ActionInspector } from "./ActionInspector.js";
import { Icon } from "../shared/index.js";
import styles from "./actions.module.css";

const statusPresentation: Record<
  TaskAction["status"],
  {
    readonly label: string;
    readonly icon: "check" | "clock" | "lock" | "square" | "x" | "alert";
  }
> = {
  // A clock, not a filled square: a square in a coloured ring reads as a stop
  // button or a failure, which is the opposite of work still going on.
  running: { label: "Pending", icon: "clock" },
  completed: { label: "Completed", icon: "check" },
  // The action ran and answered; the answer was not success. Neither marker
  // would be true here, so it gets its own.
  reported: { label: "Reported", icon: "alert" },
  failed: { label: "Failed", icon: "x" },
  denied: { label: "Denied", icon: "lock" },
  blocked: { label: "Blocked", icon: "lock" },
  cancelled: { label: "Stopped", icon: "square" },
};

export function ActionHistory({
  actions,
  readPicture,
}: {
  actions: readonly TaskAction[];
  readPicture?: NonNullable<CoreApi["readPicture"]>;
}) {
  const [inspecting, setInspecting] = useState<string>();
  const open = actions.find((action) => action.id === inspecting);

  if (actions.length === 0) return null;

  return (
    <section
      className={styles["action-history"]}
      role="region"
      aria-label="Action history"
    >
      <ul>
        {actions.map((action) => {
          const presentation = statusPresentation[action.status];
          return (
            <li
              className={`${styles["action-history__item"]} ${styles[`action-history__item--${action.status}`]}`}
              key={action.id}
            >
              <span
                className={styles["action-history__marker"]}
                {...(action.status === "completed"
                  ? { role: "img", "aria-label": presentation.label }
                  : { "aria-hidden": true })}
              >
                <Icon name={presentation.icon} />
              </span>
              <span className={styles["action-history__content"]}>
                <span className={styles["action-history__summary"]}>
                  <strong>{action.action}</strong>
                  {action.status !== "completed" && (
                    <span className={styles["action-history__status"]}>
                      {presentation.label}
                    </span>
                  )}
                </span>
                {action.description && (
                  <span className={styles["action-history__description"]}>
                    {action.description}
                  </span>
                )}
                <span className={styles["action-history__target"]}>
                  {action.target}
                </span>
                {action.reason && (
                  <span className={styles["action-history__reason"]}>
                    {action.reason}
                  </span>
                )}
                {(action.command ||
                  action.evidence ||
                  action.changes?.length ||
                  action.details?.length) && (
                  <button
                    className={`text-button ${styles["action-history__inspect"]}`}
                    type="button"
                    onClick={() => setInspecting(action.id)}
                  >
                    Inspect action
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {open && (
        <ActionInspector
          {...(readPicture ? { readPicture } : {})}
          action={open}
          onClose={() => setInspecting(undefined)}
        />
      )}
    </section>
  );
}
