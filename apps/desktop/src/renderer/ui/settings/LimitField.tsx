import { useId, useState } from "react";
import styles from "./settings.module.css";

/**
 * A whole number typed in, saved once it is left or entered. One outside its
 * range says the range and is not saved; Escape puts back what was saved.
 * What was typed stays shown until the save settles, then the saved value.
 */
export function LimitField({
  value,
  least,
  most,
  unit,
  labelledBy,
  describedBy,
  onSave,
}: {
  value: number;
  least: number;
  most: number;
  /** After the number, as "rounds" or "USD". */
  unit: string;
  labelledBy: string;
  describedBy: string;
  /** Settles once the change is saved or its failure shown. */
  onSave: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [invalid, setInvalid] = useState(false);
  const rangeId = useId();

  async function commit() {
    if (draft === undefined) return;
    const typed = draft.trim();
    const number = /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
    if (!(number >= least && number <= most)) {
      setInvalid(true);
      return;
    }
    if (number !== value) await onSave(number);
    setDraft(undefined);
  }

  const range = `A whole number from ${least.toLocaleString("en-US")} to ${most.toLocaleString("en-US")}.`;
  return (
    <div className={styles["limit-field"]}>
      <span className={styles["limit-field__entry"]}>
        <input
          type="number"
          inputMode="numeric"
          min={least}
          max={most}
          step={1}
          value={draft ?? String(value)}
          aria-labelledby={labelledBy}
          aria-describedby={invalid ? `${describedBy} ${rangeId}` : describedBy}
          {...(invalid ? { "aria-invalid": true } : {})}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commit();
            if (event.key === "Escape") {
              setDraft(undefined);
              setInvalid(false);
            }
          }}
        />
        <span aria-hidden="true" className={styles["limit-field__unit"]}>
          {unit}
        </span>
      </span>
      {invalid && (
        <span id={rangeId} className={styles["limit-field__range"]}>
          {range}
        </span>
      )}
    </div>
  );
}
