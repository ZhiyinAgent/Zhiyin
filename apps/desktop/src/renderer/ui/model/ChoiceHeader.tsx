import { CloseButton } from "../shared/index.js";
import styles from "./model.module.css";

/**
 * The page's heading, where the page sits, and closing it. What is not saved
 * yet is said at the foot of the page, beside the choice.
 */
export function ChoiceHeader({
  title = "Model",
  trail = "Zhiyin / Model",
  onClose,
}: {
  title?: string;
  /** Where the page sits, above its title. */
  trail?: string;
  onClose: () => void;
}) {
  return (
    <header className={styles["model-settings__head"]}>
      <div>
        <p className="instrument-label">{trail}</p>
        <h1 tabIndex={-1}>{title}</h1>
      </div>
      <div className={styles["model-settings__actions"]}>
        <CloseButton label="Close settings" onClick={onClose} />
      </div>
    </header>
  );
}
