import type { SpellingLanguage, SpellingState } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./settings.module.css";

/** "French (Français)", or the one name where both are the same. */
function languageLabel(language: SpellingLanguage): string {
  return language.englishName === language.name
    ? language.englishName
    : `${language.englishName} (${language.name})`;
}

/**
 * The languages spelling is checked in, each removable but the last, and a
 * list to add another from, named in English with its own name beside it.
 */
export function SpellingLanguages({
  spelling,
  labelledBy,
  describedBy,
  onChange,
}: {
  spelling: SpellingState;
  labelledBy: string;
  describedBy: string;
  onChange: (languages: readonly string[]) => void;
}) {
  const chosen = spelling.languages.map(({ code }) => code);
  const named = (code: string) =>
    spelling.offered.find((language) => language.code === code);
  const addable = spelling.offered.filter(
    (language) => !chosen.includes(language.code),
  );
  return (
    <div className={styles["spelling-languages"]}>
      <ul
        aria-label="Spelling languages"
        aria-describedby={describedBy}
        className={styles["spelling-languages__list"]}
      >
        {spelling.languages.map(({ code, status }) => {
          const language = named(code);
          const name = language ? languageLabel(language) : code;
          return (
            <li key={code} data-status={status}>
              <span>{name}</span>
              {status === "unavailable" && (
                <span className={styles["spelling-languages__note"]}>
                  Could not be loaded
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${language?.englishName ?? code}`}
                data-tip={
                  chosen.length === 1
                    ? "At least one language is checked"
                    : undefined
                }
                disabled={chosen.length === 1}
                onClick={() =>
                  onChange(chosen.filter((other) => other !== code))
                }
              >
                <Icon name="x" />
              </button>
            </li>
          );
        })}
      </ul>
      {addable.length > 0 && (
        <select
          aria-label="Add a language"
          aria-describedby={labelledBy}
          className={styles["spelling-languages__add"]}
          value=""
          onChange={(event) => {
            if (event.target.value) onChange([...chosen, event.target.value]);
          }}
        >
          <option value="">Add a language…</option>
          {addable.map((language) => (
            <option key={language.code} value={language.code}>
              {languageLabel(language)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
