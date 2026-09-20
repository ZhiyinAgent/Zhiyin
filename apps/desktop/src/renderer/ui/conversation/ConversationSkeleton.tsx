import { SkeletonBlock } from "../shared/index.js";
import styles from "./conversation.module.css";

/** A conversation taking shape: a message, and an answer forming under it. */
export function ConversationSkeleton({
  label = "Loading task",
}: {
  label?: string;
}) {
  return (
    <div className={styles["thread-skeleton"]} role="status" aria-label={label}>
      <SkeletonBlock className={styles["thread-skeleton__message"]} />
      <div className={styles["thread-skeleton__response"]}>
        <SkeletonBlock variant="avatar" />
        <span>
          <SkeletonBlock variant="line" wide />
          <SkeletonBlock variant="line" />
          <SkeletonBlock className={styles["thread-skeleton__panel"]} />
        </span>
      </div>
    </div>
  );
}
