import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./shared.module.css";

/** Which of a turn's changes the person chose to undo. */
export type UndoChoice = { readonly files: boolean; readonly memory: boolean };

/** One kind of change on offer, and what undoing it does, said beneath. */
type Offer = { readonly offered: boolean; readonly detail?: ReactNode };

/**
 * What going back, or undoing a turn, undoes: its file changes and its memory
 * changes, each a box, under one that ticks or clears both. That one is mixed
 * while only one below it is ticked. A kind with nothing to undo has no box,
 * and with one box left there is nothing to tick both of.
 */
export function UndoChoices({
  files,
  memory,
  choice,
  onChange,
  disabled,
}: {
  files: Offer;
  memory: Offer;
  choice: UndoChoice;
  onChange: (choice: UndoChoice) => void;
  disabled?: boolean;
}) {
  const both = files.offered && memory.offered;
  if (!files.offered && !memory.offered) return null;
  const boxes = (
    <>
      {files.offered && (
        <Choice
          label="Undo file changes"
          detail={files.detail}
          checked={choice.files}
          disabled={disabled}
          onChange={(on) => onChange({ ...choice, files: on })}
        />
      )}
      {memory.offered && (
        <Choice
          label="Undo memory changes"
          detail={memory.detail}
          checked={choice.memory}
          disabled={disabled}
          onChange={(on) => onChange({ ...choice, memory: on })}
        />
      )}
    </>
  );
  return (
    <fieldset className={styles["undo-choices"]}>
      <legend className={styles["undo-choices__legend"]}>What to undo</legend>
      {both ? (
        <>
          <Choice
            label="Undo everything"
            checked={choice.files && choice.memory}
            mixed={choice.files !== choice.memory}
            disabled={disabled}
            onChange={(on) => onChange({ files: on, memory: on })}
          />
          <div className={styles["undo-choices__parts"]}>{boxes}</div>
        </>
      ) : (
        boxes
      )}
    </fieldset>
  );
}

function Choice({
  label,
  detail,
  checked,
  mixed = false,
  disabled,
  onChange,
}: {
  label: string;
  detail?: ReactNode;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean | undefined;
  onChange: (on: boolean) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  const named = useId();
  const described = useId();
  useEffect(() => {
    if (box.current) box.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <label className={styles["undo-choice"]}>
      <input
        ref={box}
        type="checkbox"
        checked={checked}
        aria-checked={mixed ? "mixed" : checked}
        aria-labelledby={named}
        disabled={disabled}
        {...(detail ? { "aria-describedby": described } : {})}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong id={named}>{label}</strong>
        {detail && <span id={described}>{detail}</span>}
      </span>
    </label>
  );
}
