import type {
  BrowserIntent,
  BrowserPanelState,
  BrowserView,
} from "@zhiyin/contract";
import { BrowserPanel } from "./BrowserPanel.js";
import styles from "./browser.module.css";

/**
 * The browser as the workspace beside the conversation shows it: the panel
 * filling the space, and a way back when the browser could not run.
 */
export function BrowserSurface({
  browser,
  onDrive,
  onWatch,
  inView = true,
  onReturn,
}: {
  browser: BrowserPanelState;
  /** Whether the space holding it is on screen rather than folded away. */
  inView?: boolean;
  onDrive: (intent: BrowserIntent) => void | Promise<void>;
  /** The panel's picture size in the screen's pixels, or null once not shown. */
  onWatch?: (view: BrowserView | null) => void;
  onReturn: () => void;
}) {
  return (
    <div className={styles["browser-workspace"]}>
      <BrowserPanel
        browser={browser}
        onDrive={onDrive}
        inView={inView}
        {...(onWatch ? { onWatch } : {})}
      />
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
