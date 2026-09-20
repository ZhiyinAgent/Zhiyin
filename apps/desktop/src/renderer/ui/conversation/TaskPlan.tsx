import type { TaskPlanItem } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

const statusLabel: Record<TaskPlanItem["status"], string> = {
  pending: "Pending",
  active: "In progress",
  checking: "Checking",
  verified: "Assessed as done",
  "needs-attention": "Unresolved",
};

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
                <span>{statusLabel[item.status]}</span>
              </div>
              <p>{item.criterion}</p>
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
