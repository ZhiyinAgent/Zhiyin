import { useState } from "react";
import type { CoreApi, SpecialistRun, TaskAction } from "@zhiyin/contract";
import {
  SpecialistRunModal,
  statusPresentation,
} from "./SpecialistRunModal.js";
import { Icon } from "../shared/index.js";
import styles from "./actions.module.css";

/**
 * One delegated specialist's own run: a short card in the conversation, and
 * everything else — the task in full, the report, and each call it made,
 * through the unmodified `ActionHistory` — in a modal opened from it. A
 * specialist can make dozens of calls and write pages; none of that belongs in
 * the flow of the conversation.
 */
export function SpecialistRunHistory({
  run,
  actions,
  readPicture,
  onOpenPermission,
}: {
  run: SpecialistRun;
  actions: readonly TaskAction[];
  readPicture?: NonNullable<CoreApi["readPicture"]>;
  onOpenPermission?: (permissionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const presentation = statusPresentation[run.status];
  const ownActions = actions
    .filter(
      (action) =>
        action.specialistRunId === run.id || run.actionIds.includes(action.id),
    )
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));

  const now =
    run.status === "running"
      ? (ownActions.at(-1)?.action ?? "Starting")
      : run.status === "completed"
        ? firstLine(run.handoff?.summary)
        : firstLine(run.reason);

  return (
    <section
      className={`${styles["specialist-run"]}${run.status === "running" ? "" : ` ${styles["specialist-run--settled"]}`}`}
      aria-label={`${run.specialist.name} specialist`}
    >
      <header className={styles["specialist-run__head"]}>
        <span className={styles["specialist-run__marker"]} aria-hidden="true">
          <Icon name="users" />
        </span>
        <h3>{run.specialist.name}</h3>
        <span
          className={`${styles["specialist-run__status"]} ${styles[`specialist-run__status--${run.status}`]}`}
        >
          {run.status === "running" ? (
            <span
              className={styles["specialist-run__pulse"]}
              aria-hidden="true"
            />
          ) : (
            <Icon name={presentation.icon} />
          )}
          {presentation.label}
        </span>
      </header>
      {now && (
        <p
          className={`${styles["specialist-run__now"]}${run.status === "failed" || run.status === "interrupted" ? ` ${styles["specialist-run__now--stopped"]}` : ""}`}
        >
          {now}
        </p>
      )}
      <p className={styles["specialist-run__task"]} title={run.task}>
        {run.task}
      </p>
      <footer className={styles["specialist-run__meta"]}>
        <span>
          {ownActions.length} {ownActions.length === 1 ? "call" : "calls"}
        </span>
        <button
          className={`text-button ${styles["specialist-run__open"]}`}
          type="button"
          aria-label={`Inspect ${run.specialist.name} specialist`}
          onClick={() => setOpen(true)}
        >
          Details
        </button>
      </footer>
      {open && (
        <SpecialistRunModal
          run={run}
          actions={ownActions}
          {...(readPicture ? { readPicture } : {})}
          {...(onOpenPermission ? { onOpenPermission } : {})}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

/** A report or a reason, as one line for the card; the modal has it whole. */
function firstLine(text: string | undefined): string | undefined {
  return text
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
}
