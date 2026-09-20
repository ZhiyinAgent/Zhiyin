import { Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

export type WorkStep = {
  id: string;
  label: string;
  detail?: string;
  status: "complete" | "active" | "queued" | "failed";
};

export function WorkTrace({ steps }: { steps: WorkStep[] }) {
  const completed = steps.filter((step) => step.status === "complete").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const active = steps.some((step) => step.status === "active");

  return (
    <section
      className={styles["work-trace"]}
      role="region"
      aria-label="Work trace"
    >
      <div className={styles["work-trace__header"]}>
        <div>
          <p className="eyebrow">Work trace</p>
          <h3>
            {failed > 0
              ? `${failed} ${failed === 1 ? "action" : "actions"} failed`
              : `${completed} of ${steps.length} ${steps.length === 1 ? "action" : "actions"} complete`}
          </h3>
        </div>
        {active && (
          <span
            className={styles["work-trace__pulse"]}
            aria-label="Work in progress"
          />
        )}
      </div>
      <ol className={styles["work-trace__list"]}>
        {steps.map((step) => (
          <li
            className={`${styles["work-step"]} ${styles[`work-step--${step.status}`]}`}
            key={step.id}
          >
            <span className={styles["work-step__marker"]}>
              {step.status === "complete" && <Icon name="check" />}
              {step.status === "active" && <span />}
              {step.status === "failed" && <Icon name="x" />}
            </span>
            <div>
              <span
                className={styles["work-step__label"]}
                aria-current={step.status === "active" ? "step" : undefined}
              >
                {step.label}
              </span>
              {step.detail && <p>{step.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
