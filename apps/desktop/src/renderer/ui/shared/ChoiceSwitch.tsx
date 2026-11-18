import { useId } from "react";
import styles from "./shared.module.css";

/**
 * A few choices side by side, one of them on: a theme, a lab's platform. Real
 * radio buttons, so the arrow keys move between the choices. Switched off, it
 * still shows the choice that is on; whoever switches it off says why.
 */
export function ChoiceSwitch<Value extends string>({
  choices,
  value,
  onChange,
  disabled = false,
  ...labelled
}: {
  choices: readonly { readonly value: Value; readonly label: string }[];
  value: Value | undefined;
  onChange: (value: Value) => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      className={styles["choice-switch"]}
      aria-disabled={disabled ? true : undefined}
      {...labelled}
    >
      {choices.map((choice) => (
        <label key={choice.value}>
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            disabled={disabled}
            onChange={() => {
              if (!disabled) onChange(choice.value);
            }}
          />
          <span>{choice.label}</span>
        </label>
      ))}
    </div>
  );
}
