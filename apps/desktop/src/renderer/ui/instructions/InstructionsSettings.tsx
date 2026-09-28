import { CloseButton } from "../shared/index.js";
import { PersonalInstructions } from "./PersonalInstructions.js";
import styles from "./instructions.module.css";

/** The standalone page for instructions that apply to every conversation. */
export function InstructionsSettings({
  saved,
  onSave,
  onClose,
}: {
  saved: string;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <section
      className={styles["instructions-page"]}
      aria-label="Custom instructions"
    >
      <header className={styles["instructions-page__head"]}>
        <div>
          <p className="instrument-label">Workspace / Preferences</p>
          <h1>Custom instructions</h1>
          <p>
            Set the default way Zhiyin should work with you. These instructions
            are sent with each new message and remain separate from model
            choice.
          </p>
        </div>
        <CloseButton label="Close custom instructions" onClick={onClose} />
      </header>
      <PersonalInstructions saved={saved} onSave={onSave} />
    </section>
  );
}
