import { ConversationSkeleton } from "../conversation/index.js";
import { SidebarSkeleton } from "../sidebar/index.js";
import styles from "./app.module.css";

/**
 * The window taking shape before the core has answered, in the shell's own
 * frame: the sidebar, gone where the window is too narrow for one, then the
 * bar the window is dragged by over the conversation.
 */
export function WindowSkeleton({
  label = "Loading workspace",
}: {
  label?: string;
}) {
  return (
    <main className={styles["app-shell"]} role="status" aria-label={label}>
      <SidebarSkeleton />
      <div className={styles["window-skeleton__main"]}>
        <div className={styles["top-bar"]} />
        <ConversationSkeleton
          label="Loading current task"
          note="Opening your conversations…"
        />
      </div>
    </main>
  );
}
