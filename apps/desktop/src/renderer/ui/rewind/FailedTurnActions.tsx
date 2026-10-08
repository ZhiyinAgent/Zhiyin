import type { TurnRemedy } from "@zhiyin/contract";
import { useGoingBack, type GoingBackProps } from "./goingBack.js";
import styles from "./rewind.module.css";

/** The steps that leave the conversation as it is. */
export type OtherStep = Exclude<TurnRemedy, "tryAgain" | "editMessage">;

const labels: Record<TurnRemedy, string> = {
  tryAgain: "Try again",
  continue: "Continue",
  updateApiKey: "Update API key",
  openSettings: "Open the Model page",
  chooseModel: "Choose a model",
  chooseLargerModel: "Choose a model with a larger window",
  addCredits: "Add OpenRouter credits",
  editMessage: "Edit the message",
};

type FailedTurnActionsProps = {
  remedies: readonly TurnRemedy[];
  /**
   * Going back to the message the turn answered, which trying again and
   * editing need. Absent when that message cannot be gone back to.
   */
  goingBack?: GoingBackProps;
  /** Opens the message the turn answered for editing, where it is. */
  onEdit?: () => void;
  onStep: (step: OtherStep) => void;
};

/**
 * What a person can do about a failed turn, as buttons, the first one leading.
 * Trying again resends the message, asking first exactly as the message's own
 * button does, and editing opens the message where it is.
 */
export function FailedTurnActions({
  remedies,
  goingBack,
  onEdit,
  onStep,
}: FailedTurnActionsProps) {
  if (goingBack)
    return (
      <WithGoingBack
        remedies={remedies}
        goingBack={goingBack}
        {...(onEdit ? { onEdit } : {})}
        onStep={onStep}
      />
    );
  const offered = remedies.filter(
    (remedy): remedy is OtherStep =>
      remedy !== "tryAgain" && remedy !== "editMessage",
  );
  if (!offered.length) return null;
  return (
    <div className={styles.remedies}>
      {offered.map((remedy, index) => (
        <button
          key={remedy}
          type="button"
          className={stepClass(index)}
          onClick={() => onStep(remedy)}
        >
          {labels[remedy]}
        </button>
      ))}
    </div>
  );
}

function WithGoingBack({
  remedies,
  goingBack,
  onEdit,
  onStep,
}: FailedTurnActionsProps & { goingBack: GoingBackProps }) {
  const { busy, send, question } = useGoingBack(goingBack);
  const offered = remedies.filter(
    (remedy) => remedy !== "editMessage" || onEdit,
  );
  if (!offered.length) return null;
  return (
    <>
      <div className={styles.remedies}>
        {offered.map((remedy, index) => (
          <button
            key={remedy}
            type="button"
            className={stepClass(index)}
            disabled={busy}
            onClick={() => {
              if (remedy === "tryAgain") void send("resend");
              else if (remedy === "editMessage") onEdit?.();
              else onStep(remedy);
            }}
          >
            {labels[remedy]}
          </button>
        ))}
      </div>
      {question}
    </>
  );
}

function stepClass(index: number) {
  return index === 0
    ? "button button--accent button--small"
    : "button button--quiet button--small";
}
