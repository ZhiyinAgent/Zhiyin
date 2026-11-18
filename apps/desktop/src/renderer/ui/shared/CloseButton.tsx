import { Icon } from "./Icon.js";
import styles from "./shared.module.css";

/** The round close control in the corner of a page-sized panel. */
export function CloseButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={styles["panel-close"]}
      type="button"
      aria-label={label}
      onClick={onClick}
    >
      <Icon name="x" />
    </button>
  );
}
