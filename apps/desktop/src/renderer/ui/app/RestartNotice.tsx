import { Icon } from "../shared/index.js";
import styles from "./app.module.css";

/**
 * Said once when the window came back after its page crashed. The core held
 * everything while it was gone, so there is nothing to recover and nothing to
 * do; the person is only told why the window blinked. Whoever shows it decides
 * when it has been said: it holds no state of its own, so a view that is taken
 * down and put back cannot say it again.
 */
export function RestartNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className={styles["restart-notice"]} role="status">
      <span className={styles["restart-notice__badge"]} aria-hidden="true">
        <Icon name="check" />
      </span>
      <div className={styles["restart-notice__text"]}>
        <p className={styles["restart-notice__title"]}>
          The window restarted after a problem.
        </p>
        <p className={styles["restart-notice__detail"]}>Your work is intact.</p>
      </div>
      <button
        className={styles["restart-notice__dismiss"]}
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
