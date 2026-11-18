import { Icon } from "../shared/index.js";
import type { Surface } from "./SurfaceSwitch.js";
import styles from "./beside.module.css";

const marks = { browser: "globe", document: "file", "3d": "cube" } as const;
const shows: Readonly<Record<Surface, string>> = {
  browser: "Show the browser",
  document: "Show the document",
  "3d": "Show the 3D view",
};

/**
 * The conversation's own record that something is open beside it, and the
 * way into it.
 *
 * A tab appearing in the header is not an event anyone notices. This says the
 * thing that happened, in the place where what happens is written down, and
 * goes away once what is beside is on screen — it exists to be acted on once,
 * not to sit there being a status.
 */
export function BesideNotice({
  text,
  surface,
  onShow,
}: {
  text: string;
  /** What is open beside the conversation, which the button names. */
  surface: Surface;
  onShow: () => void;
}) {
  return (
    <div className={styles["beside-notice"]}>
      <Icon name={marks[surface]} />
      <p>{text}</p>
      <button className="text-button" type="button" onClick={onShow}>
        {shows[surface]}
      </button>
    </div>
  );
}
