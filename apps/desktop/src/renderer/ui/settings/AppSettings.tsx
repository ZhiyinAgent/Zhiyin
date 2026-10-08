import { useId, useState, type ReactNode } from "react";
import type {
  Appearance,
  SpellingChoice,
  SpellingState,
} from "@zhiyin/contract";
import { CloseButton } from "../shared/index.js";
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

export function AppSettings({
  notifications,
  onNotifications,
  appearance = "system",
  onAppearance,
  spelling,
  onSpelling,
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
  /** Absent when the core does not check spelling. ADR 0023. */
  spelling?: SpellingState | undefined;
  onSpelling?: (choice: SpellingChoice) => Promise<void>;
  /** Absent when the core does not offer it. ADR 0019. */
  onOpenDataFolder?: () => Promise<void>;
  /** Conversations an earlier version saved, not opened until updated. */
  waitingForUpdate?: number;
  /** Asks again about them. ADR 0022. */
  onUpdateConversations?: () => void;
  onClose: () => void;
}) {
  const [failure, setFailure] = useState("");
  const choiceName = useId();

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
    <section className={styles["app-settings"]} aria-label="Settings">
      <header className={styles["app-settings__head"]}>
        <div>
          <p className="instrument-label">Workspace / Settings</p>
          <h1>Settings</h1>
        </div>
        <CloseButton label="Close settings" onClick={onClose} />
      </header>
      <div className={styles["app-settings__body"]}>
        {failure && (
          <p className={styles["app-settings__failure"]} role="alert">
            {failure}
          </p>
        )}
        {onAppearance && (
          <SettingsGroup title="On screen">
            <SettingRow
              title="Appearance"
              description="Match Windows follows the light or dark mode set in Windows, and changes when it does."
              control={(label, description) => (
                <div
                  role="radiogroup"
                  aria-labelledby={label}
                  aria-describedby={description}
                  className={styles["setting-choices"]}
                >
                  {appearances.map((choice) => (
                    <label key={choice.value}>
                      <input
                        type="radio"
                        name={choiceName}
                        value={choice.value}
                        checked={appearance === choice.value}
                        onChange={() =>
                          void change(() => onAppearance(choice.value))
                        }
                      />
                      <span>{choice.label}</span>
                    </label>
                  ))}
                </div>
              )}
            />
          </SettingsGroup>
        )}
        {spelling && onSpelling && (
          <SettingsGroup title="Writing">
            <SettingRow
              title="Check spelling"
              description="Underlines words that look misspelled as you type. Right-click one to correct it."
              control={(label, description) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={spelling.enabled}
                  aria-labelledby={label}
                  aria-describedby={description}
                  className={styles["setting-switch"]}
                  onClick={() =>
                    void change(() =>
                      onSpelling({
                        enabled: !spelling.enabled,
                        languages: spelling.languages.map(({ code }) => code),
                      }),
                    )
                  }
                >
                  <span aria-hidden="true" />
                </button>
              )}
            />
            {spelling.enabled && (
              <SettingRow
                stacked
                title="Languages"
                description="A word is not underlined if any of these languages knows it."
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
        {onNotifications && (
          <SettingsGroup title="While you are away">
            <SettingRow
              title="Notifications"
              description="When Zhiyin needs your approval or an answer, or finishes a long task, while you are in another app."
              control={(label, description) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={notifications}
                  aria-labelledby={label}
                  aria-describedby={description}
                  className={styles["setting-switch"]}
                  onClick={() =>
                    void change(() => onNotifications(!notifications))
                  }
                >
                  <span aria-hidden="true" />
                </button>
              )}
            />
          </SettingsGroup>
        )}
        {(onOpenDataFolder ||
          (onUpdateConversations && waitingForUpdate > 0)) && (
          <SettingsGroup title="Your data">
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
                description="Your conversations, pictures and file copies are kept here, exactly as sent to the model, including any passwords or keys the assistant used. This folder stays on this computer."
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
    </section>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={styles["settings-group"]} aria-labelledby={id}>
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
