import { Icon } from "../shared/index.js";
import styles from "./workspace.module.css";

/**
 * The conversation's own record that something is open beside it, and the
 * way into it.
 *
 * A tab appearing in the header is not an event anyone notices. This says the
 * thing that happened, in the place where what happens is written down, and
 * goes away once the workspace is on screen — it exists to be acted on once,
 * not to sit there being a status.
 */
export function WorkspaceNotice({
  text,
  icon = "globe",
  onShow,
}: {
  text: string;
  icon?: "globe" | "file";
  onShow: () => void;
}) {
  return (
    <div className={styles["workspace-notice"]}>
      <Icon name={icon} />
      <p>{text}</p>
      <button className="text-button" type="button" onClick={onShow}>
        Show workspace
      </button>
    </div>
  );
}
