import { useEffect, useState } from "react";
import { SkeletonBlock } from "../shared/index.js";
import styles from "./conversation.module.css";

/** How long shapes alone are enough before a wait is worth a word. */
const noticeableWait = 2_000;

/**
 * A conversation taking shape: a message, and an answer forming under it. A
 * load that runs long enough to notice gets one quiet line saying what is
 * being opened.
 */
export function ConversationSkeleton({
  label = "Loading task",
  note = "Opening this conversation…",
}: {
  label?: string;
  note?: string;
}) {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), noticeableWait);
    return () => clearTimeout(timer);
  }, []);
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
      {waited && <p className={styles["thread-skeleton__note"]}>{note}</p>}
    </div>
  );
}
