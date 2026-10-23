import { ConversationSkeleton } from "../conversation/index.js";
import { SkeletonBlock } from "../shared/index.js";
import styles from "./app.module.css";

/**
 * The window taking shape before the core has answered, in the shell's own
 * frame: the sidebar, gone where the window is too narrow for one, then the
 * bar the window is dragged by over the conversation.
 */
export function WorkspaceSkeleton({
  label = "Loading workspace",
}: {
  label?: string;
}) {
  return (
    <main className={styles["app-shell"]} role="status" aria-label={label}>
      <div className={styles["app-sidebar"]}>
        <div className={styles["app-sidebar__brand"]}>
          <SkeletonBlock className={styles["workspace-skeleton__brand"]} />
        </div>
        <SkeletonBlock className={styles["workspace-skeleton__button"]} />
        {[0, 1, 2, 3].map((row) => (
          <SkeletonBlock
            className={styles["workspace-skeleton__nav"]}
            key={row}
          />
        ))}
      </div>
      <div className={styles["workspace-skeleton__main"]}>
        <div className={styles["top-bar"]} />
        <ConversationSkeleton
          label="Loading current task"
          note="Opening your conversations…"
        />
      </div>
    </main>
  );
}
