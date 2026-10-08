import { useEffect, useId, useRef, useState } from "react";
import type { CoreApi, SpecialistRun, TaskAction } from "@zhiyin/contract";
import { ActionHistory } from "./ActionHistory.js";
import { Icon } from "../shared/index.js";
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
  readPicture,
  onOpenPermission,
  onClose,
}: {
  run: SpecialistRun;
  actions: readonly TaskAction[];
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

  useEffect(() => {
    const returnTo = document.activeElement;
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A call's own inspector opened from here is above this dialog, and is
      // the one Escape is meant for.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== dialog.current) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [onClose]);

  const tabs: readonly [Tab, string, number | undefined][] = [
    ["report", "Report", undefined],
    ["calls", "Calls", actions.length],
  ];
  const took = duration(run.startedAt, run.finishedAt);

  return (
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
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            setTab((current) => (current === "report" ? "calls" : "report"));
          }}
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
              {handoff && (
                <>
                  {paragraphs(handoff.summary).map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                  <ReportPart title="Findings" items={handoff.findings} />
                  <ReportPart
                    title="Recommendations"
                    items={handoff.recommendations}
                  />
                  <ReportPart title="Limitations" items={handoff.limitations} />
                </>
              )}
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
            <p className={styles["specialist-report__empty"]}>No calls yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportPart({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  if (items.length === 0) return null;
  return (
    <section className={styles["specialist-report__part"]}>
      <h3>
        {title} <span>{items.length}</span>
      </h3>
      <ol>
        {items.map((item, index) => {
          const lead = leadOf(item);
          return (
            <li key={index}>
              {lead ? (
                <>
                  <strong>{lead.lead}</strong>
                  {lead.rest}
                </>
              ) : (
                item
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * A short label before the first colon — "MAJOR (§11)", "Fidélité élevée" —
 * which a reader scans for. Anything longer is a sentence, not a label.
 */
function leadOf(
  item: string,
): { readonly lead: string; readonly rest: string } | undefined {
  const match = /^([^:\n]{2,90}?)(\s?:\s)/.exec(item);
  if (!match?.[1] || /[.!?]\s/.test(match[1])) return undefined;
  return { lead: match[1], rest: item.slice(match[1].length) };
}

/** The report's own paragraphs; a model often writes one line per point. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function duration(start: string, end: string | undefined): string | undefined {
  if (!end) return undefined;
  const seconds = Math.round((Date.parse(end) - Date.parse(start)) / 1_000);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes} min ${seconds % 60} s`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
