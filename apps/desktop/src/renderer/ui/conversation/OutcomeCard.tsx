import { Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

type OutcomeCardProps = {
  title: string;
  file: string;
  summary: string;
  onOpen?: () => void;
};

export function OutcomeCard({
  title,
  file,
  summary,
  onOpen,
}: OutcomeCardProps) {
  return (
    <section className={styles["outcome-card"]} aria-label="Completed result">
      <div className={styles["outcome-card__mark"]}>
        <Icon name="check" />
      </div>
      <div className={styles["outcome-card__copy"]}>
        <p className="eyebrow">Ready for review</p>
        <h3>{title}</h3>
        <p>{summary}</p>
      </div>
      {onOpen ? (
        <button
          className={styles["outcome-card__file"]}
          type="button"
          aria-label={`Open ${file}`}
          onClick={onOpen}
        >
          <Icon name="file" />
          <span>{file}</span>
          <span>Open →</span>
        </button>
      ) : (
        <div
          className={`${styles["outcome-card__file"]} ${styles["outcome-card__file--static"]}`}
        >
          <Icon name="file" />
          <span>{file}</span>
          <span>Created</span>
        </div>
      )}
    </section>
  );
}
