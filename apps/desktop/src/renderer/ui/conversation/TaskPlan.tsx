import type { TaskPlanItem } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

const progressLabel: Record<NonNullable<TaskPlanItem["progress"]>, string> = {
  pending: "Pending",
  in_progress: "In progress",
  done: "Done (the assistant says)",
  cancelled: "Cancelled",
};

const verdictLabel: Partial<Record<TaskPlanItem["status"], string>> = {
  checking: "Checking",
  verified: "Assessed as done",
  "needs-attention": "Not verified",
  "couldnt-judge": "Couldn't judge",
};

/**
 * Where an item stands: what the assistant says, then the assessment, each in
 * its own words so one is never read as the other. Plans saved before the
 * assistant reported progress carry it in the assessment's field.
 */
function standing(item: TaskPlanItem): string {
  const progress = item.progress
    ? progressLabel[item.progress]
    : item.status === "active"
      ? "In progress"
      : item.status === "pending"
        ? "Pending"
        : undefined;
  return [progress, verdictLabel[item.status]].filter(Boolean).join(" · ");
}

export function TaskPlan({ items }: { items: readonly TaskPlanItem[] }) {
  if (items.length === 0) return null;

  return (
    <section
      className={styles["task-plan"]}
      role="region"
      aria-label="Task plan"
    >
      <div className={styles["task-plan__heading"]}>
        <h3>Plan · AI assessment</h3>
        <span>
          {items.filter((item) => item.status === "verified").length}/
          {items.length} assessed as done
        </span>
      </div>
      <ol>
        {items.map((item) => (
          <li
            className={`${styles["task-plan__item"]} ${styles[`task-plan__item--${item.status}`]}`}
            key={item.id}
          >
            <span className={styles["task-plan__marker"]}>
              {item.status === "verified" ? (
                <Icon name="check" />
              ) : item.status === "needs-attention" ? (
                <Icon name="x" />
              ) : (
                <span />
              )}
            </span>
            <div className={styles["task-plan__content"]}>
              <div className={styles["task-plan__summary"]}>
                <strong>{item.title}</strong>
                <span>{standing(item)}</span>
              </div>
              <p>{item.criterion}</p>
              {item.addedBy && (
                <p className={styles["task-plan__verification"]}>
                  Added by the assistant
                </p>
              )}
              {item.progressNote && (
                <p className={styles["task-plan__verification"]}>
                  {item.progressNote}
                </p>
              )}
              {item.verification && (
                <p className={styles["task-plan__verification"]}>
                  {item.verification}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
