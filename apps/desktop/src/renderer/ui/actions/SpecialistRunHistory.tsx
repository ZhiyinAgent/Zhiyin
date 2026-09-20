import type { CoreApi, SpecialistRun, TaskAction } from "@zhiyin/contract";
import { ActionHistory } from "./ActionHistory.js";
import { Icon } from "../shared/index.js";
import styles from "./actions.module.css";

const statusPresentation: Record<
  SpecialistRun["status"],
  { readonly label: string; readonly icon: "clock" | "check" | "x" | "square" }
> = {
  running: { label: "Running", icon: "clock" },
  completed: { label: "Completed", icon: "check" },
  failed: { label: "Failed", icon: "x" },
  interrupted: { label: "Stopped", icon: "square" },
};

/**
 * One delegated specialist's own run, drawn with the same production
 * components as the main task's history: a `WorkTrace`-shaped header for the
 * run itself, then its own actions through the unmodified `ActionHistory`.
 */
export function SpecialistRunHistory({
  run,
  actions,
  readPicture,
}: {
  run: SpecialistRun;
  actions: readonly TaskAction[];
  readPicture?: NonNullable<CoreApi["readPicture"]>;
}) {
  const presentation = statusPresentation[run.status];
  const ownActions = actions.filter((action) =>
    run.actionIds.includes(action.id),
  );

  return (
    <section
      className={styles["specialist-run"]}
      role="region"
      aria-label={`${run.specialist.name} specialist`}
    >
      <div className={styles["specialist-run__header"]}>
        <span className={styles["specialist-run__marker"]} aria-hidden="true">
          <Icon name="users" />
        </span>
        <div className={styles["specialist-run__content"]}>
          <p className="eyebrow">Specialist: {run.specialist.name}</p>
          <h3>{run.task}</h3>
        </div>
        <span
          className={`${styles["specialist-run__status"]} ${styles[`specialist-run__status--${run.status}`]}`}
        >
          <Icon name={presentation.icon} />
          {presentation.label}
        </span>
      </div>
      {run.status === "completed" && run.handoff && (
        <div className={styles["specialist-run__handoff"]}>
          <p>{run.handoff.summary}</p>
          {run.handoff.findings.length > 0 && (
            <>
              <p className="eyebrow">Findings</p>
              <ul>
                {run.handoff.findings.map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            </>
          )}
          {run.handoff.recommendations.length > 0 && (
            <>
              <p className="eyebrow">Recommendations</p>
              <ul>
                {run.handoff.recommendations.map((recommendation) => (
                  <li key={recommendation}>{recommendation}</li>
                ))}
              </ul>
            </>
          )}
          {run.handoff.limitations.length > 0 && (
            <>
              <p className="eyebrow">Limitations</p>
              <ul>
                {run.handoff.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {(run.status === "failed" || run.status === "interrupted") &&
        run.reason && (
          <p className={styles["specialist-run__reason"]}>{run.reason}</p>
        )}
      <ActionHistory
        actions={ownActions}
        {...(readPicture ? { readPicture } : {})}
      />
    </section>
  );
}
