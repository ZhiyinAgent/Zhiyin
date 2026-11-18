import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  defaultLook,
  lookIds,
  lookStrengths,
  workPauseRange,
  type AppUpdateState,
  type Appearance,
  type LookChoice,
  type SpellingChoice,
  type SpellingState,
  type WorkPauses,
} from "@zhiyin/contract";
import {
  ChoiceSwitch,
  SurfacePanel,
  Toggle,
  listed,
  lookWords,
  strengthNames,
} from "../shared/index.js";
import { LimitField } from "./LimitField.js";
import { SpellingLanguages } from "./SpellingLanguages.js";
import { appUpdateStatus } from "./appUpdateStatus.js";
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

/** Every listed look, and the strengths, as the rows offer them. */
const lookChoices = lookIds.map((value) => ({
  value,
  label: lookWords[value].name,
}));
const strengthChoices = lookStrengths.map((value) => ({
  value,
  label: strengthNames[value],
}));
/** The looks a strength changes, named for a look that has none. */
const pictureLooks = listed(
  lookIds
    .filter((id) => lookWords[id].pictures)
    .map((id) => lookWords[id].name),
  "or",
);

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
  look = defaultLook,
  onLook,
  spelling,
  onSpelling,
  workPauses,
  onWorkPauses,
  studioReviews = true,
  onStudioReviews,
  reviewerModel,
  onChooseReviewerModel,
  onUseConversationModel,
  onOpenDataFolder,
  waitingForUpdate = 0,
  onUpdateConversations,
  appUpdate,
  onAppUpdateChecks,
  onCheckForAppUpdate,
  onRestartToUpdate,
  modelList,
  onClose,
}: {
  notifications: boolean;
  /** Absent when the core does not offer notifications. */
  onNotifications?: ((enabled: boolean) => Promise<void>) | undefined;
  appearance?: Appearance;
  /** Absent where the choice cannot be applied, as in the demo. */
  onAppearance?: ((appearance: Appearance) => Promise<void>) | undefined;
  /** The look and its strength. ADR 0028. */
  look?: LookChoice | undefined;
  /** Absent where the choice cannot be made. */
  onLook?: ((choice: LookChoice) => Promise<void>) | undefined;
  /** Absent when the core does not check spelling. ADR 0027. */
  spelling?: SpellingState | undefined;
  onSpelling?: ((choice: SpellingChoice) => Promise<void>) | undefined;
  /** When long tasks stop to ask whether to go on. */
  workPauses?: WorkPauses;
  /** Absent when the core does not offer the choice. */
  onWorkPauses?: ((pauses: WorkPauses) => Promise<void>) | undefined;
  /** Whether studio work with a spec is reviewed before a task ends. ADR 0024. */
  studioReviews?: boolean;
  /** Absent when the core does not offer the choice. */
  onStudioReviews?: ((enabled: boolean) => Promise<void>) | undefined;
  /** The model chosen for reviews, named; absent while it is the conversation's. */
  reviewerModel?: string | undefined;
  /** Opens the choice of the model reviews run on; absent where it cannot be made. */
  onChooseReviewerModel?: () => void;
  onUseConversationModel?: () => Promise<void>;
  /** Absent when the core does not offer it. ADR 0025. */
  onOpenDataFolder?: (() => Promise<void>) | undefined;
  /** Conversations an earlier version saved, not opened until updated. */
  waitingForUpdate?: number;
  /** Asks again about them. ADR 0025. */
  onUpdateConversations?: () => void;
  /** Where updating Zhiyin stands; absent where this copy does not update. ADR 0027. */
  appUpdate?: AppUpdateState | undefined;
  onAppUpdateChecks?: (enabled: boolean) => Promise<void>;
  onCheckForAppUpdate?: (() => Promise<void>) | undefined;
  onRestartToUpdate?: (() => Promise<void>) | undefined;
  /**
   * Zhiyin's list of models and prices (ADR 0027): where it comes from in a
   * sentence, and whether newer ones are looked for; absent until read.
   */
  modelList?: {
    words: string;
    updates: boolean;
    onUpdates: (enabled: boolean) => void;
  };
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
      eyebrow={<p className="instrument-label">Zhiyin / Settings</p>}
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
        {(onAppearance || onLook) && (
          <SettingsGroup title="On screen" area="screen">
            {onAppearance && (
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
            )}
            {onLook && (
              <>
                <SettingRow
                  title="Look"
                  description="The pictures and marks the window is drawn with."
                  control={(label, description) => (
                    <ChoiceSwitch
                      aria-labelledby={label}
                      aria-describedby={description}
                      choices={lookChoices}
                      value={look.look}
                      onChange={(value) =>
                        void change(() =>
                          onLook({ look: value, strength: look.strength }),
                        )
                      }
                    />
                  )}
                />
                <SettingRow
                  title="Strength"
                  description={
                    lookWords[look.look].pictures
                      ? "How strongly the look's pictures show."
                      : `${lookWords[look.look].name} has no picture to adjust. Choose ${pictureLooks} to set it.`
                  }
                  control={(label, description) => (
                    <ChoiceSwitch
                      aria-labelledby={label}
                      aria-describedby={description}
                      choices={strengthChoices}
                      value={look.strength}
                      disabled={!lookWords[look.look].pictures}
                      onChange={(value) =>
                        void change(() =>
                          onLook({ look: look.look, strength: value }),
                        )
                      }
                    />
                  )}
                />
              </>
            )}
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
        {((workPauses && onWorkPauses) || onStudioReviews) && (
          <SettingsGroup title="Long tasks" area="long">
            {workPauses &&
              onWorkPauses &&
              pauseRows.map((row) => (
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
            {onStudioReviews && (
              <SettingRow
                title="Review 3D and CAD work"
                description="Before a 3D or CAD task ends, a second model checks the result against what you asked, up to twice. This adds to the conversation's cost."
                control={(label, description) => (
                  <Toggle
                    on={studioReviews}
                    aria-labelledby={label}
                    aria-describedby={description}
                    onChange={(on) => void change(() => onStudioReviews(on))}
                  />
                )}
              />
            )}
            {onStudioReviews && studioReviews && onChooseReviewerModel && (
              <SettingRow
                title="Reviewer model"
                description={
                  reviewerModel
                    ? `${reviewerModel}, whichever model the conversation uses.`
                    : "By default, the same model starting fresh. A model from another lab may catch different mistakes."
                }
                control={(_label, description) => (
                  <span className={styles["setting-row__actions"]}>
                    {reviewerModel && onUseConversationModel && (
                      <button
                        type="button"
                        className="button"
                        aria-describedby={description}
                        onClick={() => void change(onUseConversationModel)}
                      >
                        Use the conversation's
                      </button>
                    )}
                    <button
                      type="button"
                      className="button"
                      aria-describedby={description}
                      onClick={onChooseReviewerModel}
                    >
                      {reviewerModel ? "Change…" : "Choose…"}
                    </button>
                  </span>
                )}
              />
            )}
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
        {((appUpdate && onAppUpdateChecks) || modelList) && (
          <SettingsGroup title="Updates" area="updates">
            {modelList && (
              <SettingRow
                title="Keep models and prices up to date"
                description={modelList.words}
                live
                control={(label, description) => (
                  <Toggle
                    on={modelList.updates}
                    aria-labelledby={label}
                    aria-describedby={description}
                    onChange={modelList.onUpdates}
                  />
                )}
              />
            )}
            {appUpdate && onAppUpdateChecks && (
              <>
                <SettingRow
                  title="Look for newer versions"
                  description="Zhiyin looks on GitHub, or on its own site when GitHub cannot be reached, and installs only versions its makers signed. Nothing of yours is sent."
                  control={(label, description) => (
                    <Toggle
                      on={appUpdate.checks}
                      aria-labelledby={label}
                      aria-describedby={description}
                      onChange={(on) =>
                        void change(() => onAppUpdateChecks(on))
                      }
                    />
                  )}
                />
                <SettingRow
                  title={`Version ${appUpdate.version}`}
                  description={appUpdateStatus(appUpdate)}
                  live
                  control={(_label, description) =>
                    appUpdate.phase.kind === "ready" ||
                    appUpdate.phase.kind === "restarting"
                      ? onRestartToUpdate && (
                          <button
                            type="button"
                            className={`button ${styles["setting-row__action"]}`}
                            aria-describedby={description}
                            disabled={appUpdate.phase.kind === "restarting"}
                            onClick={() => void change(onRestartToUpdate)}
                          >
                            Restart to update
                          </button>
                        )
                      : onCheckForAppUpdate && (
                          <button
                            type="button"
                            className={`button ${styles["setting-row__action"]}`}
                            aria-describedby={description}
                            disabled={
                              !appUpdate.checks ||
                              appUpdate.phase.kind !== "idle"
                            }
                            onClick={() => void change(onCheckForAppUpdate)}
                          >
                            Check now
                          </button>
                        )
                  }
                />
              </>
            )}
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
  area: "screen" | "writing" | "long" | "away" | "data" | "updates";
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
  live = false,
}: {
  title: string;
  description: string;
  /** The description changes on its own, and is read out when it does. */
  live?: boolean;
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
        <p id={described} role={live ? "status" : undefined}>
          {description}
        </p>
      </div>
      {control(label, described)}
    </div>
  );
}
