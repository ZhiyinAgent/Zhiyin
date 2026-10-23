import { useEffect, useState } from "react";
import type { ShellAvailability } from "@zhiyin/contract";
import styles from "./capabilities.module.css";

/**
 * Says that shell commands cannot run, where they cannot, and how to get
 * them. The shell is read once when the page opens and again on request, so
 * one installed just now is picked up.
 */
export function ShellNotice({
  onCheck,
  onRecheck,
  onOpenExternalUrl,
}: {
  /** The current reading, fetched once on open — never cached beyond that. */
  onCheck: () => Promise<ShellAvailability>;
  /** Re-detects the shell on request, so an install just now is picked up. */
  onRecheck: () => Promise<ShellAvailability>;
  onOpenExternalUrl: (url: string) => Promise<void>;
}) {
  const [shell, setShell] = useState<ShellAvailability | undefined>();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    void onCheck()
      .then((result) => {
        if (live) setShell(result);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [onCheck]);

  async function recheck() {
    setChecking(true);
    try {
      setShell(await onRecheck());
    } catch {
      // The previous reading stays; the button is there to try again.
    } finally {
      setChecking(false);
    }
  }

  if (!shell || shell.available) return null;
  return (
    <div role="status" className={styles["shell-notice"]}>
      <span>Shell commands are unavailable. {shell.reason}</span>
      {/* Only an install changes the answer, so without one there is nothing
          to do here. */}
      {shell.installUrl ? (
        <span className={styles["shell-notice__actions"]}>
          <button
            type="button"
            className="button button--small"
            onClick={() => void onOpenExternalUrl(shell.installUrl as string)}
          >
            Get Git for Windows
          </button>
          <button
            type="button"
            className="button button--small button--quiet"
            disabled={checking}
            onClick={() => void recheck()}
          >
            {checking ? "Checking…" : "Check again"}
          </button>
        </span>
      ) : null}
    </div>
  );
}
