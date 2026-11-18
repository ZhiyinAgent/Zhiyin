import { SkeletonBlock } from "../shared/index.js";
import styles from "./sidebar.module.css";

/**
 * The sidebar taking shape before the core has answered: its column, with
 * placeholders where the name, New conversation and the list will be. Like the
 * sidebar it stands for, it folds away where the window is too narrow.
 */
export function SidebarSkeleton() {
  return (
    <div
      className={`${styles["app-sidebar"]} ${styles["app-sidebar--drawer"]}`}
    >
      <div className={styles["app-sidebar__brand"]}>
        <SkeletonBlock className={styles["sidebar-skeleton__brand"]} />
      </div>
      <SkeletonBlock className={styles["sidebar-skeleton__button"]} />
      {[0, 1, 2, 3].map((row) => (
        <SkeletonBlock className={styles["sidebar-skeleton__nav"]} key={row} />
      ))}
    </div>
  );
}
