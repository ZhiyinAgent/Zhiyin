import type { BrowserIntent, BrowserPanelState } from "@zhiyin/contract";
import { BrowserPanel } from "./BrowserPanel.js";
import styles from "./browser.module.css";

/**
 * The browser as the workspace beside the conversation shows it: the panel
 * filling the space, and a way back when the browser could not run.
 */
export function BrowserSurface({
  browser,
  onDrive,
  onReturn,
}: {
  browser: BrowserPanelState;
  onDrive: (intent: BrowserIntent) => void | Promise<void>;
  onReturn: () => void;
}) {
  return (
    <div className={styles["browser-workspace"]}>
      <BrowserPanel browser={browser} onDrive={onDrive} />
      {browser.status === "failed" && (
        <button
          className={`text-button ${styles["browser-workspace__return"]}`}
          type="button"
          onClick={onReturn}
        >
          Return to conversation
        </button>
      )}
    </div>
  );
}
