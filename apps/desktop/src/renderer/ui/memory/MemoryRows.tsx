import type { MemoryEntry } from "@zhiyin/contract";
import type { MemoryScope } from "./memory.js";
import { shortDate } from "./memoryWords.js";
import styles from "./memory.module.css";

/**
 * Entries as rows: number, title, summary (an instruction section has none,
 * and shows its scope) and when last used, each opening
 * its entry. Rows from several scopes also say which scope each is in.
 */
export function MemoryRows({
  label,
  entries,
  scopes,
  showScope = false,
  onOpen,
}: {
  label: string;
  entries: readonly MemoryEntry[];
  scopes: readonly MemoryScope[];
  showScope?: boolean;
  onOpen: (number: number) => void;
}) {
  const names = new Map(scopes.map((scope) => [scope.id, scope.name]));
  return (
    <ul className={styles["memory-rows"]} aria-label={label}>
      {entries.map((entry) => (
        <li key={entry.number}>
          <button
            type="button"
            className={styles["memory-row"]}
            onClick={() => onOpen(entry.number)}
          >
            <span className={styles["memory-row__number"]}>
              #{entry.number}
            </span>
            <span className={styles["memory-row__words"]}>
              <strong>{entry.title}</strong>
              <span>{entry.summary || names.get(entry.scope)}</span>
            </span>
            <span className={styles["memory-row__side"]}>
              {showScope && (
                <span className={styles["memory-row__scope"]}>
                  {names.get(entry.scope)}
                </span>
              )}
              <span>{shortDate(entry.used ?? entry.written)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
