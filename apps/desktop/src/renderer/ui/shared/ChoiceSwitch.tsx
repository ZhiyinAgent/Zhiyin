import { useId } from "react";
import styles from "./shared.module.css";

/**
 * A few choices side by side, one of them on: a theme, a lab's platform. Real
 * radio buttons, so the arrow keys move between the choices.
 */
export function ChoiceSwitch<Value extends string>({
  choices,
  value,
  onChange,
  ...labelled
}: {
  choices: readonly { readonly value: Value; readonly label: string }[];
  value: Value | undefined;
  onChange: (value: Value) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" className={styles["choice-switch"]} {...labelled}>
      {choices.map((choice) => (
        <label key={choice.value}>
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <span>{choice.label}</span>
        </label>
      ))}
    </div>
  );
}
