import { useState } from "react";
import type { CoreApi, SpecialistRun, TaskAction } from "@zhiyin/contract";
import {
  SpecialistRunModal,
  statusPresentation,
} from "./SpecialistRunModal.js";
import { Icon } from "../shared/index.js";
import { actionTitle } from "./actionTitle.js";
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
    .sort((left, right) => left.sequence - right.sequence);

  // While it runs its task leads and its latest call follows, with what that
  // call was on, so the card is seen to move; once done, the outcome leads.
  const running = run.status === "running";
  const latest = ownActions.at(-1);
  const now = running
    ? latest
      ? stepOf(latest)
      : "Starting"
    : run.status === "completed"
      ? firstLine(run.handoff?.summary)
      : firstLine(run.reason);
  const lead = running ? run.task : now;
  const small = running ? now : run.task;

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
      {lead && (
        <p
          className={`${styles["specialist-run__now"]}${run.status === "failed" || run.status === "interrupted" ? ` ${styles["specialist-run__now--stopped"]}` : ""}`}
        >
          {lead}
        </p>
      )}
      {small && (
        <p className={styles["specialist-run__task"]} data-tip={small}>
          {small}
        </p>
      )}
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

/** A call as one line: what it did, and on what when its name does not say. */
function stepOf(action: TaskAction): string {
  const title = actionTitle(action);
  return action.target &&
    !title.toLocaleLowerCase().includes(action.target.toLocaleLowerCase())
    ? `${title}: ${action.target}`
    : title;
}

/** A report or a reason, as one line for the card; the modal has it whole. */
function firstLine(text: string | undefined): string | undefined {
  return text
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
}
