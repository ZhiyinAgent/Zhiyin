import { useState, type ComponentType } from "react";
import type { CoreApi, SpecialistRun, TaskAction } from "@zhiyin/contract";
import { ActionHistory } from "../action-history/ActionHistory.js";
import {
  Dialog,
  elapsedTime,
  Icon,
  moveAmongTabs,
  type DialogLook,
} from "../../shared/index.js";
import { statusWords } from "../actionWords.js";
import common from "../actions.module.css";
import { recordLook } from "../recordLook.js";
import styles from "./specialists.module.css";

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
  readPicture?: NonNullable<CoreApi["readPicture"]> | undefined;
  onOpenPermission?: ((permissionId: string) => void) | undefined;
  onClose: () => void;
}) {
  const presentation = statusWords[run.status];
  const handoff = run.status === "completed" ? run.handoff : undefined;
  const stopped =
    (run.status === "failed" || run.status === "interrupted") && run.reason
      ? run.reason
      : undefined;
  const hasReport = Boolean(handoff || stopped);
  const [tab, setTab] = useState<Tab>(hasReport ? "report" : "calls");

  const tabs: readonly [Tab, string, number | undefined][] = [
    ["report", "Report", undefined],
    ["calls", "Calls", actions.length],
  ];
  const took = duration(run.startedAt, run.finishedAt);

  return (
    <Dialog
      title={run.specialist.name}
      look={look}
      heading={(title) => (
        <>
          <div className={styles["specialist-modal__title"]}>
            <p className="eyebrow">Specialist</p>
            {title}
          </div>
          <span
            className={`${styles["specialist-run__status"]} ${styles[`specialist-run__status--${run.status}`]}`}
          >
            <Icon name={presentation.icon} />
            {presentation.label}
            {took && ` · ${took}`}
          </span>
        </>
      )}
      tabs={(panelId) => (
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
      )}
      onClose={onClose}
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
          onOpenPermission={onOpenPermission}
          readPicture={readPicture}
        />
      ) : (
        <p className={styles["specialist-report__empty"]}>No calls yet.</p>
      )}
    </Dialog>
  );
}

/** A record dialog sized to a run: narrower, and only as tall as it holds. */
const look: DialogLook = {
  ...recordLook,
  dialog: `${common["diff-modal"]} ${common["diff-modal--narrow"]}`,
  body: styles["specialist-modal__panel"] ?? "",
};

function duration(start: string, end: string | undefined): string | undefined {
  if (!end) return undefined;
  const took = Date.parse(end) - Date.parse(start);
  return Number.isFinite(took) && took >= 0 ? elapsedTime(took) : undefined;
}
