import { ConversationSkeleton } from "../conversation/index.js";
import { SkeletonBlock } from "../shared/index.js";
import styles from "./app.module.css";

/**
 * The window taking shape before the core has answered: the sidebar, the
 * conversation, and the outline of the shelf beside it.
 */
export function WorkspaceSkeleton({
  label = "Loading workspace",
}: {
  label?: string;
}) {
  return (
    <main
      className={styles["workspace-skeleton"]}
      role="status"
      aria-label={label}
    >
      <div className={styles["workspace-skeleton__sidebar"]}>
        <SkeletonBlock className={styles["workspace-skeleton__brand"]} />
        <SkeletonBlock className={styles["workspace-skeleton__button"]} />
        {[0, 1, 2, 3].map((row) => (
          <SkeletonBlock
            className={styles["workspace-skeleton__nav"]}
            key={row}
          />
        ))}
      </div>
      <div className={styles["workspace-skeleton__main"]}>
        <SkeletonBlock className={styles["workspace-skeleton__header"]} />
        <ConversationSkeleton
          label="Loading current task"
          note="Opening your conversations…"
        />
      </div>
      <aside
        className={styles["workspace-skeleton__shelf"]}
        role="status"
        aria-label="Loading session context"
      >
        <SkeletonBlock className={styles["workspace-skeleton__label"]} />
        <SkeletonBlock className={styles["workspace-skeleton__heading"]} />
        {[0, 1, 2].map((row) => (
          <span className={styles["workspace-skeleton__context-row"]} key={row}>
            <SkeletonBlock className={styles["workspace-skeleton__file"]} />
            <SkeletonBlock variant="line" />
          </span>
        ))}
      </aside>
    </main>
  );
}
