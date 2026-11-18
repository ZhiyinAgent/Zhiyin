import { useState } from "react";
import type { ProviderSettings } from "@zhiyin/contract";
import { Icon, StandalonePage } from "../shared/index.js";
import { ModelSetup, type ModelSetupCommands } from "./ModelSetup.js";
import styles from "./model.module.css";

/**
 * Onboarding's step that connects a model, handed to onboarding by the shell.
 * Continue stays off until a model is in use; Set up later leaves it undone,
 * and the new-task page then offers the same three parts.
 */
export function ModelStep({
  label,
  settings,
  onBack,
  onContinue,
  onLater,
  ...commands
}: ModelSetupCommands & {
  /** Where the step stands, such as "STEP 2 OF 3". */
  label: string;
  settings: ProviderSettings;
  onBack: () => void;
  onContinue: () => void;
  onLater: () => void;
}) {
  const [chosen, setChosen] = useState(false);
  const ready =
    chosen ||
    (Boolean(settings.model) && settings.credential.status === "configured");
  return (
    <StandalonePage
      layout="split"
      tagline="A little more you."
      label={label}
      title="Connect an AI model"
      introduction="Zhiyin does its work through an AI model you choose, on your own account. That account is billed for what Zhiyin uses, and Zhiyin shows the cost of every conversation."
      note="You can change all of this later on the Model page."
      actions={
        <span className={styles["model-step__actions"]}>
          <button
            type="button"
            className="button button--quiet"
            onClick={onBack}
          >
            Back
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={onLater}
          >
            Set up later
          </button>
          <button
            type="button"
            className="button button--accent"
            disabled={!ready}
            data-tip={ready ? undefined : "Choose a model first"}
            onClick={onContinue}
          >
            Continue
            <Icon name="arrow-up" />
          </button>
        </span>
      }
    >
      <ModelSetup
        settings={settings}
        onChosen={() => setChosen(true)}
        {...commands}
      />
    </StandalonePage>
  );
}
