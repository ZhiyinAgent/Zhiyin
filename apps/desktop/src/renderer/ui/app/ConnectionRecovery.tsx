import styles from "./app.module.css";

/** What the window shows when it cannot reach the app behind it. */
export function ConnectionRecovery({ onRetry }: { onRetry: () => void }) {
  return (
    <main className={styles["connection-recovery"]}>
      <h1>Let’s reconnect.</h1>
      <p>Your saved work has not been removed.</p>
      <button className="button button--accent" onClick={onRetry}>
        Try again
      </button>
    </main>
  );
}
