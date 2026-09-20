import type { ReactNode } from "react";
import styles from "./shared.module.css";

/** A short boxed statement in the conversation: something stopped or failed. */
export function Notice({
  role,
  children,
}: {
  role: "alert" | "status";
  children: ReactNode;
}) {
  return (
    <div className={styles.notice} role={role}>
      {children}
    </div>
  );
}
