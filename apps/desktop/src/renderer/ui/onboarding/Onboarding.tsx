import { useState } from "react";
import { Icon, StandalonePage } from "../shared/index.js";
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
] as const;

export function Onboarding({
  onComplete,
}: {
  onComplete: (interests: readonly string[]) => Promise<void>;
}) {
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
  return (
    <StandalonePage
      tagline="A little more you."
      label="WELCOME TO ZHIYIN"
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
      }
      {...(error ? { error } : {})}
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
