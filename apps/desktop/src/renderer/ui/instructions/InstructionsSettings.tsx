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
            Set the preferences Zhiyin should remember when it works with you.
          </p>
        </div>
        <CloseButton label="Close custom instructions" onClick={onClose} />
      </header>
      <div className={styles["instructions-page__layout"]}>
        <PersonalInstructions saved={saved} onSave={onSave} />
        <aside className={styles["instructions-page__guide"]}>
          <div>
            <span className="instrument-label">Good starting points</span>
            <h2>Make it specific</h2>
            <ul>
              <li>Which language should replies use?</li>
              <li>How much detail is helpful?</li>
              <li>Where should drafts or reports go?</li>
            </ul>
          </div>
          <div>
            <span className="instrument-label">How it works</span>
            <p>
              Saved instructions apply from your next message in every
              conversation. They guide the answer, but never approve an action
              for you.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
