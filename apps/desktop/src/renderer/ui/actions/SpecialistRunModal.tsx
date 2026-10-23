import { useId, useRef, useState, type ComponentType } from "react";
import type { CoreApi, SpecialistRun, TaskAction } from "@zhiyin/contract";
import { ActionHistory } from "./ActionHistory.js";
import {
  elapsedTime,
  Icon,
  WindowLayer,
  moveAmongTabs,
  useModalFocus,
} from "../shared/index.js";
import styles from "./actions.module.css";

export const statusPresentation: Record<
  SpecialistRun["status"],
  { readonly label: string; readonly icon: "clock" | "check" | "x" | "square" }
> = {
  running: { label: "Running", icon: "clock" },
  completed: { label: "Completed", icon: "check" },
  failed: { label: "Failed", icon: "x" },
  interrupted: { label: "Stopped", icon: "square" },
};

type Tab = "report" | "calls";

/**
 * Everything a specialist did, opened from its card: the report to read, and
 * the calls one tab away so a long report is not pushed down by dozens of
 * them, or the other way round.
 */
export function SpecialistRunModal({
  run,
  actions,
  Markdown,
  readPicture,
  onOpenPermission,
  onClose,
}: {
  run: SpecialistRun;
  actions: readonly TaskAction[];
  /** Draws the report's Markdown, as the conversation draws an answer's. */
  Markdown: ComponentType<{ readonly children: string }>;
  readPicture?: NonNullable<CoreApi["readPicture"]>;
  onOpenPermission?: (permissionId: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const panelId = useId();
  const presentation = statusPresentation[run.status];
  const handoff = run.status === "completed" ? run.handoff : undefined;
  const stopped =
    (run.status === "failed" || run.status === "interrupted") && run.reason
      ? run.reason
      : undefined;
  const hasReport = Boolean(handoff || stopped);
  const [tab, setTab] = useState<Tab>(hasReport ? "report" : "calls");

  // A call's own inspector opened from here is above this dialog, and is
  // the one Escape is meant for.
  useModalFocus(dialog, onClose);

  const tabs: readonly [Tab, string, number | undefined][] = [
    ["report", "Report", undefined],
    ["calls", "Calls", actions.length],
  ];
  const took = duration(run.startedAt, run.finishedAt);

  return (
    <WindowLayer>
      <div
        className={styles["diff-modal__scrim"]}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          className={`${styles["diff-modal"]} ${styles["specialist-modal"]}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          ref={dialog}
        >
          <header className={styles["diff-modal__header"]}>
            <div className={styles["specialist-modal__title"]}>
              <p className="eyebrow">Specialist</p>
              <h2 id={titleId}>{run.specialist.name}</h2>
            </div>
            <span
              className={`${styles["specialist-run__status"]} ${styles[`specialist-run__status--${run.status}`]}`}
            >
              <Icon name={presentation.icon} />
              {presentation.label}
              {took && ` · ${took}`}
            </span>
            <button
              className="button button--quiet"
              type="button"
              onClick={onClose}
            >
              Close
            </button>
          </header>
          <div
            className={styles["specialist-modal__tabs"]}
            role="tablist"
            aria-label="Specialist run"
            onKeyDown={moveAmongTabs}
          >
            {tabs.map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls={panelId}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
              >
                {label} {count !== undefined && <span>{count}</span>}
              </button>
            ))}
          </div>
          <div
            className={styles["specialist-modal__panel"]}
            id={panelId}
            role="tabpanel"
          >
            {tab === "report" ? (
              <div className={styles["specialist-report"]}>
                <details className={styles["specialist-report__task"]}>
                  <summary>Task</summary>
                  <p>{run.task}</p>
                </details>
                {stopped && (
                  <p className={styles["specialist-run__reason"]}>{stopped}</p>
                )}
                {handoff && <Markdown>{handoff.report}</Markdown>}
                {!hasReport && (
                  <p className={styles["specialist-report__empty"]}>
                    No report yet. The specialist reports when it finishes.
                  </p>
                )}
              </div>
            ) : actions.length > 0 ? (
              <ActionHistory
                actions={actions}
                {...(onOpenPermission ? { onOpenPermission } : {})}
                {...(readPicture ? { readPicture } : {})}
              />
            ) : (
              <p className={styles["specialist-report__empty"]}>
                No calls yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </WindowLayer>
  );
}

function duration(start: string, end: string | undefined): string | undefined {
  if (!end) return undefined;
  const took = Date.parse(end) - Date.parse(start);
  return Number.isFinite(took) && took >= 0 ? elapsedTime(took) : undefined;
}
