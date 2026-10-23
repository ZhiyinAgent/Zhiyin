import { SurfacePanel } from "../shared/index.js";
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
    <SurfacePanel
      label="Custom instructions"
      eyebrow={
        <p className="instrument-label">
          Your preferences / Custom instructions
        </p>
      }
      title="Custom instructions"
      description="Set the preferences Zhiyin should remember when it works with you."
      closeLabel="Close custom instructions"
      onClose={onClose}
    >
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
    </SurfacePanel>
  );
}
