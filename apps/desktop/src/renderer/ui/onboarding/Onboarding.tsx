import { useState, type ReactNode } from "react";
import type { LookChoice } from "@zhiyin/contract";
import { Icon, StandalonePage } from "../shared/index.js";
import { LookStep } from "./LookStep.js";
import styles from "./onboarding.module.css";

/**
 * What the grid offers. The ids are the built-in plugins' names, and choosing
 * one switches that plugin on; the words and icons are this module's, because
 * nothing behind the window draws.
 */
export const interestOptions = [
  {
    id: "engineering",
    title: "Build software",
    detail: "Design, build, test, and review a project.",
    icon: "code",
  },
  {
    id: "publishing",
    title: "Write papers & reports",
    detail: "Typeset documents with sound citations.",
    icon: "file",
  },
  {
    id: "data-science",
    title: "Understand data",
    detail: "Explore, test, and explain what it shows.",
    icon: "usage",
  },
  {
    id: "research",
    title: "Research a question",
    detail: "Find, check, and weigh the sources.",
    icon: "search",
  },
  {
    id: "3d-rendering",
    title: "Make 3D scenes",
    detail: "Model, light, and render products, rooms, and parts.",
    icon: "cube",
  },
] as const;

/** Where the model step stands and where it leads, handed to its drawing. */
export type ModelStepPlace = {
  /** Such as "STEP 2 OF 3". */
  readonly label: string;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  /** Leaves the model unset; the new-task page offers it again. */
  readonly onLater: () => void;
};

/**
 * The welcome: what the person is here for, then connecting a model where
 * the shell hands in that step, then, where the window can change its look,
 * how it should look. With neither it is the first step alone. The model
 * step is drawn by the module that owns models; this one only places it.
 */
export function Onboarding({
  onComplete,
  onLook,
  look,
  modelStep,
}: {
  onComplete: (interests: readonly string[]) => Promise<void>;
  onLook?: (choice: LookChoice) => Promise<void>;
  look?: LookChoice;
  modelStep?: (place: ModelStepPlace) => ReactNode;
}) {
  const [step, setStep] = useState<"interests" | "model" | "look">("interests");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function complete() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onComplete(selected);
    } catch {
      setError("Your preferences could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }
  const looks = onLook && look ? { onLook, look } : undefined;
  const count = 1 + (modelStep ? 1 : 0) + (looks ? 1 : 0);
  const of = (at: number) => `STEP ${at} OF ${count}`;
  const afterModel = () => (looks ? setStep("look") : void complete());
  if (modelStep && step === "model")
    return modelStep({
      label: of(2),
      onBack: () => setStep("interests"),
      onContinue: afterModel,
      onLater: afterModel,
    });
  if (looks && step === "look")
    return (
      <LookStep
        {...looks}
        label={of(count)}
        onBack={() => {
          setError("");
          setStep(modelStep ? "model" : "interests");
        }}
        onStart={() => void complete()}
        starting={saving}
        error={error}
      />
    );
  return (
    <StandalonePage
      layout="split"
      tagline="A little more you."
      label={count > 1 ? `WELCOME TO ZHIYIN · ${of(1)}` : "WELCOME TO ZHIYIN"}
      title={
        <>
          Where will your
          <br />
          curiosity take you?
        </>
      }
      introduction="What are you planning to use Zhiyin for? Choose where to start. You can change this anytime."
      note="This is a starting point, never a limit."
      actions={
        count > 1 ? (
          <button
            type="button"
            className="button button--accent"
            onClick={() => setStep(modelStep ? "model" : "look")}
          >
            Continue
            <Icon name="arrow-up" />
          </button>
        ) : (
          <button
            type="button"
            className="button button--accent"
            disabled={saving}
            onClick={() => void complete()}
          >
            {saving
              ? "Getting ready…"
              : selected.length
                ? "Make it yours"
                : "Start exploring"}
            <Icon name="arrow-up" />
          </button>
        )
      }
      error={error}
    >
      <div className={styles["interest-grid"]} aria-label="Your interests">
        {interestOptions.map((item) => (
          <button
            key={item.id}
            className={styles["interest-card"]}
            type="button"
            aria-pressed={selected.includes(item.id)}
            disabled={saving}
            onClick={() =>
              setSelected((current) =>
                current.includes(item.id)
                  ? current.filter((id) => id !== item.id)
                  : [...current, item.id],
              )
            }
          >
            <Icon name={item.icon} />
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
            <span className={styles["interest-card__check"]} aria-hidden="true">
              {selected.includes(item.id) ? (
                <Icon name="check" />
              ) : (
                <Icon name="plus" />
              )}
            </span>
          </button>
        ))}
      </div>
    </StandalonePage>
  );
}
