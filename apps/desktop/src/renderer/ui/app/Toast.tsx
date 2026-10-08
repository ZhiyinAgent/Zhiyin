import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../shared/index.js";
import styles from "./app.module.css";

const shownForMs = 4_000;

/**
 * A short confirmation that something the person asked for is done. The live
 * region is always present, so a screen reader hears each message as it
 * arrives; the message itself leaves on its own.
 */
export function useToast(): readonly [ReactNode, (message: string) => void] {
  const [toast, setToast] = useState<{ id: number; message: string }>();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), shownForMs);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const show = useCallback(
    (message: string) =>
      setToast((previous) => ({ id: (previous?.id ?? 0) + 1, message })),
    [],
  );

  const region = (
    <div className={styles["toast-region"]} role="status" aria-live="polite">
      {toast && (
        <div className={styles.toast} key={toast.id}>
          <span className={styles.toast__icon} aria-hidden="true">
            <Icon name="check" />
          </span>
          {toast.message}
        </div>
      )}
    </div>
  );
  return [region, show];
}
