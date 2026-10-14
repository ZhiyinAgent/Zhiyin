import styles from "./shared.module.css";

/**
 * Something that is on or off: a plugin, one of its parts, a setting. A
 * button that says whether it is on, drawn as a small slider.
 */
export function Toggle({
  on,
  onChange,
  disabled,
  ...labelled
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      {...labelled}
      disabled={disabled}
      className={styles.toggle}
      onClick={() => onChange(!on)}
    >
      <span aria-hidden="true" />
    </button>
  );
}
