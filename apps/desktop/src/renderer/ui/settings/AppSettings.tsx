import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  workPauseRange,
  type Appearance,
  type SpellingChoice,
  type SpellingState,
  type WorkPauses,
} from "@zhiyin/contract";
import { ChoiceSwitch, SurfacePanel, Toggle } from "../shared/index.js";
import { LimitField } from "./LimitField.js";
import { SpellingLanguages } from "./SpellingLanguages.js";
import styles from "./settings.module.css";

/**
 * The app's own settings, apart from the model: a few plain rows, each saying
 * what it changes in a sentence, with its control on the right.
 */
const appearances: readonly { value: Appearance; label: string }[] = [
  { value: "system", label: "Match Windows" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Each limit on long tasks, as its row says it. */
const pauseRows: readonly {
  name: keyof WorkPauses;
  title: string;
  description: string;
  unit: string;
}[] = [
  {
    name: "rounds",
    title: "Rounds of actions",
    description:
      "Zhiyin asks whether to continue after this many rounds of actions. The limit doubles each time you continue.",
    unit: "rounds",
  },
  {
    name: "minutes",
    title: "Time",
    description:
      "Zhiyin asks whether to continue after a task has run this long. The clock restarts each time you continue.",
    unit: "minutes",
  },
  {
    name: "dollars",
    title: "Spending in US dollars",
    description:
      "Zhiyin asks whether to continue after a task has cost this much, as the provider reports or estimates it.",
    unit: "USD",
  },
  {
    name: "yuan",
    title: "Spending in yuan",
    description: "The same limit, for providers that bill in yuan.",
    unit: "CNY",
  },
];

export function AppSettings({
  notifications,
  onNotifications,
  appearance = "system",
  onAppearance,
  spelling,
  onSpelling,
  workPauses,
  onWorkPauses,
  onOpenDataFolder,
  waitingForUpdate = 0,
  onUpdateConversations,
  onClose,
}: {
  notifications: boolean;
  /** Absent when the core does not offer notifications. */
  onNotifications?: (enabled: boolean) => Promise<void>;
  appearance?: Appearance;
  /** Absent where the choice cannot be applied, as in the demo. */
  onAppearance?: (appearance: Appearance) => Promise<void>;
  /** Absent when the core does not check spelling. ADR 0030. */
  spelling?: SpellingState | undefined;
  onSpelling?: (choice: SpellingChoice) => Promise<void>;
  /** When long tasks stop to ask whether to go on. */
  workPauses?: WorkPauses;
  /** Absent when the core does not offer the choice. */
  onWorkPauses?: (pauses: WorkPauses) => Promise<void>;
  /** Absent when the core does not offer it. ADR 0027. */
  onOpenDataFolder?: () => Promise<void>;
  /** Conversations an earlier version saved, not opened until updated. */
  waitingForUpdate?: number;
  /** Asks again about them. ADR 0028. */
  onUpdateConversations?: () => void;
  onClose: () => void;
}) {
  const [failure, setFailure] = useState("");
  // The limits as last heard from the core, and as the person set them: a
  // save started before the core answers the one before builds on it, and
  // the core's word takes over once nothing is still being saved.
  const heardPauses = useRef(workPauses);
  const setPauses = useRef(workPauses);
  const saving = useRef(0);
  useEffect(() => {
    heardPauses.current = workPauses;
    if (saving.current === 0) setPauses.current = workPauses;
  }, [workPauses]);

  async function change(save: () => Promise<void>) {
    setFailure("");
    try {
      await save();
    } catch (cause) {
      setFailure(
        cause instanceof Error
          ? cause.message
          : "The change was not saved. Try again.",
      );
    }
  }

  return (
    <SurfacePanel
      label="Settings"
      eyebrow={<p className="instrument-label">Your preferences / Settings</p>}
      title="Settings"
      closeLabel="Close settings"
      onClose={onClose}
    >
      <div className={styles["app-settings__body"]}>
        {failure && (
          <p className={styles["app-settings__failure"]} role="alert">
            {failure}
          </p>
        )}
        {onAppearance && (
          <SettingsGroup title="On screen" area="screen">
            <SettingRow
              title="Appearance"
              description="Light, dark, or the same as Windows."
              control={(label, description) => (
                <ChoiceSwitch
                  aria-labelledby={label}
                  aria-describedby={description}
                  choices={appearances}
                  value={appearance}
                  onChange={(value) => void change(() => onAppearance(value))}
                />
              )}
            />
          </SettingsGroup>
        )}
        {spelling && onSpelling && (
          <SettingsGroup title="Writing" area="writing">
            <SettingRow
              title="Check spelling"
              description="Underlines misspelled words as you type. Right-click one to correct it."
              control={(label, description) => (
                <Toggle
                  on={spelling.enabled}
                  aria-labelledby={label}
                  aria-describedby={description}
                  onChange={(enabled) =>
                    void change(() =>
                      onSpelling({
                        enabled,
                        languages: spelling.languages.map(({ code }) => code),
                      }),
                    )
                  }
                />
              )}
            />
            {spelling.enabled && (
              <SettingRow
                stacked
                title="Languages"
                description="Words in these languages are not marked as misspelled."
                control={(label, description) => (
                  <SpellingLanguages
                    spelling={spelling}
                    labelledBy={label}
                    describedBy={description}
                    onChange={(languages) =>
                      void change(() =>
                        onSpelling({ enabled: true, languages }),
                      )
                    }
                  />
                )}
              />
            )}
          </SettingsGroup>
        )}
        {workPauses && onWorkPauses && (
          <SettingsGroup title="Long tasks" area="long">
            {pauseRows.map((row) => (
              <SettingRow
                key={row.name}
                title={row.title}
                description={row.description}
                control={(label, description) => (
                  <LimitField
                    value={workPauses[row.name]}
                    least={workPauseRange[row.name][0]}
                    most={workPauseRange[row.name][1]}
                    unit={row.unit}
                    labelledBy={label}
                    describedBy={description}
                    onSave={(value) => {
                      const next = {
                        ...(setPauses.current ?? workPauses),
                        [row.name]: value,
                      };
                      setPauses.current = next;
                      saving.current += 1;
                      return change(async () => {
                        try {
                          await onWorkPauses(next);
                        } catch (cause) {
                          // Only this limit goes back, to what the core holds.
                          const held = heardPauses.current ?? workPauses;
                          setPauses.current = {
                            ...next,
                            ...setPauses.current,
                            [row.name]: held[row.name],
                          };
                          throw cause;
                        } finally {
                          saving.current -= 1;
                        }
                      });
                    }}
                  />
                )}
              />
            ))}
          </SettingsGroup>
        )}
        {onNotifications && (
          <SettingsGroup title="While you are away" area="away">
            <SettingRow
              title="Notifications"
              description="Alerts you in another app when Zhiyin needs an answer or an approval, or finishes a long task."
              control={(label, description) => (
                <Toggle
                  on={notifications}
                  aria-labelledby={label}
                  aria-describedby={description}
                  onChange={(on) => void change(() => onNotifications(on))}
                />
              )}
            />
          </SettingsGroup>
        )}
        {(onOpenDataFolder ||
          (onUpdateConversations && waitingForUpdate > 0)) && (
          <SettingsGroup title="Your data" area="data">
            {onUpdateConversations && waitingForUpdate > 0 && (
              <SettingRow
                title="Conversations from an earlier version"
                description={`${waitingForUpdate === 1 ? "One conversation was" : `${waitingForUpdate} conversations were`} saved by an earlier version of Zhiyin, and ${waitingForUpdate === 1 ? "opens" : "open"} once updated.`}
                control={(_label, description) => (
                  <button
                    type="button"
                    className={`button ${styles["setting-row__action"]}`}
                    aria-describedby={description}
                    onClick={onUpdateConversations}
                  >
                    Update or delete…
                  </button>
                )}
              />
            )}
            {onOpenDataFolder && (
              <SettingRow
                title="Data folder"
                description="Where your conversations, pictures and file copies are kept on this computer, exactly as sent to the model, including any passwords or keys the assistant used."
                control={(_label, description) => (
                  <button
                    type="button"
                    className={`button ${styles["setting-row__action"]}`}
                    aria-describedby={description}
                    onClick={() => void change(onOpenDataFolder)}
                  >
                    Open data folder
                  </button>
                )}
              />
            )}
          </SettingsGroup>
        )}
      </div>
    </SurfacePanel>
  );
}

function SettingsGroup({
  title,
  area,
  children,
}: {
  title: string;
  /** Where the group stands when the page is wide enough for two columns. */
  area: "screen" | "writing" | "long" | "away" | "data";
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      className={`${styles["settings-group"]} ${styles[`settings-group--${area}`]}`}
      aria-labelledby={id}
    >
      <h2 id={id}>{title}</h2>
      <div className={styles["settings-group__rows"]}>{children}</div>
    </section>
  );
}

/** One setting: what it is, what it changes, and its control. */
function SettingRow({
  title,
  description,
  control,
  stacked = false,
}: {
  title: string;
  description: string;
  /** The control below the words, across the row, for one that needs room. */
  stacked?: boolean;
  /** Given the ids of the title and the description, to name the control. */
  control: (label: string, description: string) => ReactNode;
}) {
  const label = useId();
  const described = useId();
  return (
    <div
      className={`${styles["setting-row"]}${stacked ? ` ${styles["setting-row--stacked"]}` : ""}`}
    >
      <div>
        <strong id={label}>{title}</strong>
        <p id={described}>{description}</p>
      </div>
      {control(label, described)}
    </div>
  );
}
