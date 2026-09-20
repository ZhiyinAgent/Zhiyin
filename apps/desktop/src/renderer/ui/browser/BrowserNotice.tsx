import { Icon } from "../shared/index.js";
import styles from "./browser.module.css";

/**
 * The conversation's own record that a browser is open, and the way into it.
 *
 * A tab appearing in the header is not an event anyone notices. This says the
 * thing that happened, in the place where what happens is written down, and
 * goes away once the workspace is on screen — it exists to be acted on once,
 * not to sit there being a status.
 */
export function BrowserNotice({ onShow }: { onShow: () => void }) {
  return (
    <div className={styles["browser-notice"]}>
      <Icon name="globe" />
      <p>Zhiyin opened a browser.</p>
      <button className="text-button" type="button" onClick={onShow}>
        Show workspace
      </button>
    </div>
  );
}
