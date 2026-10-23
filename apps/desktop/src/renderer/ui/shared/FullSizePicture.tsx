import { Dialog } from "./Dialog.js";
import styles from "./shared.module.css";

/**
 * A picture at the largest size the window allows, in the app's own dialog:
 * named at the top, with Close beside the name, so how to close it is on
 * screen.
 */
export function FullSizePicture({
  source,
  alt,
  title = alt,
  onClose,
}: {
  source: string;
  alt: string;
  /** What the dialog is called: the file's name, when it has one. */
  title?: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      className={styles["full-size-picture"] ?? ""}
    >
      <img src={source} alt={alt} />
    </Dialog>
  );
}
