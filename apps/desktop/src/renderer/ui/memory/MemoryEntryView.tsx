import { useEffect, useId, useRef, useState } from "react";
import { type MemoryEntry } from "@zhiyin/contract";
import { estimatedTokens } from "@zhiyin/context-budget";
import { Icon } from "../shared/index.js";
import { MemoryRows } from "./MemoryRows.js";
import { MemoryText } from "./MemoryText.js";
import {
  linkedFrom,
  linksOf,
  listLine,
  type MemoryScope,
  type Room,
} from "./memory.js";
import { sectionNames, shortDate } from "./memoryWords.js";
import styles from "./memory.module.css";

export type EntryChange = {
  readonly title: string;
  readonly summary: string;
  readonly text: string;
};

/**
 * One entry, read as a page: its text with its links, where it came from,
 * the entries it links to and those linking to it, and editing in place. A
 * draft is an instruction written the first time: only its editor, which
 * goes back when cancelled.
 */
export function MemoryEntryView({
  entry,
  draft = false,
  entries,
  scopes,
  movesTo,
  room,
  startEditing = false,
  onOpen,
  onBack,
  onSave,
  onDelete,
  onMove,
}: {
  entry: MemoryEntry;
  draft?: boolean;
  entries: readonly MemoryEntry[];
  scopes: readonly MemoryScope[];
  /** The scopes it may be kept for, its own among them. */
  movesTo: readonly MemoryScope[];
  room: Room;
  startEditing?: boolean;
  onOpen: (number: number) => void;
  onBack: () => void;
  onSave: (change: EntryChange) => Promise<boolean>;
  onDelete: () => void;
  /** Keeps the entry for another scope. */
  onMove: (scope: string) => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const scope = scopes.find((one) => one.id === entry.scope);
  const kept = new Map(entries.map((one) => [one.number, one]));
  const linksTo = linksOf(entry).flatMap((number) => {
    const target = kept.get(number);
    return target ? [target] : [];
  });
  const from = linkedFrom(entry.number, entries);
  // Knowledge is named by the model; the other sections by what they are.
  const named = entry.section === "knowledge";

  useEffect(() => {
    if (!editing) heading.current?.focus();
  }, [entry.number, editing]);

  return (
    <div className={styles["memory-entry"]}>
      <button
        type="button"
        className={`text-button ${styles["memory-back"]}`}
        onClick={onBack}
      >
        <Icon name="chevron" />
        Back
      </button>
      <article
        className={styles["memory-entry__page"]}
        aria-labelledby={titleId}
      >
        <p className={styles["memory-entry__where"]}>
          {!draft && <span>#{entry.number}</span>}
          <span>{sectionNames[entry.section]}</span>
          {scope && <span>{scope.name}</span>}
        </p>
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {entry.title}
        </h2>
        {editing ? (
          <EntryEditor
            entry={entry}
            named={named}
            room={room}
            onCancel={() => (draft ? onBack() : setEditing(false))}
            onSave={async (change) => {
              if (await onSave(change)) setEditing(false);
            }}
          />
        ) : (
          <>
            {entry.summary && (
              <p className={styles["memory-entry__summary"]}>{entry.summary}</p>
            )}
            <MemoryText text={entry.text} entries={entries} onOpen={onOpen} />
            <footer className={styles["memory-entry__foot"]}>
              <p>
                Written {shortDate(entry.written)}
                {entry.conversation && (
                  <>
                    {" "}
                    in “<cite>{entry.conversation.title}</cite>”
                  </>
                )}
                {entry.used && <> · Last used {shortDate(entry.used)}</>}
              </p>
              <span className={styles["memory-entry__actions"]}>
                {named && (
                  <label className={styles["memory-entry__scope"]}>
                    <span>Kept for</span>
                    <select
                      aria-label="Kept for"
                      value={entry.scope}
                      onChange={(event) => onMove(event.target.value)}
                    >
                      {movesTo.map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="button button--small"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </button>
                {named && (
                  <button
                    type="button"
                    className="button button--small button--quiet"
                    onClick={onDelete}
                  >
                    Delete
                  </button>
                )}
              </span>
            </footer>
          </>
        )}
        {!draft && (linksTo.length > 0 || from.length > 0) && (
          <div className={styles["memory-entry__links"]}>
            {linksTo.length > 0 && (
              <section>
                <h3>Links to</h3>
                <MemoryRows
                  label="Links to"
                  entries={linksTo}
                  scopes={scopes}
                  onOpen={onOpen}
                />
              </section>
            )}
            {from.length > 0 && (
              <section>
                <h3>Linked from</h3>
                <MemoryRows
                  label="Linked from"
                  entries={from}
                  scopes={scopes}
                  onOpen={onOpen}
                />
              </section>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

function EntryEditor({
  entry,
  named,
  room,
  onCancel,
  onSave,
}: {
  entry: MemoryEntry;
  named: boolean;
  room: Room;
  onCancel: () => void;
  onSave: (change: EntryChange) => Promise<void>;
}) {
  const [title, setTitle] = useState(entry.title);
  const [summary, setSummary] = useState(entry.summary);
  const [text, setText] = useState(entry.text);
  const [saving, setSaving] = useState(false);
  // As a share of the space, which reads the same in any script.
  const taken = room.beside + estimatedTokens(text.trim());
  const percent = Math.round((taken / room.space) * 100);
  const over = taken > room.space;
  const longLine =
    room.line !== undefined &&
    estimatedTokens(listLine(entry.number, title.trim(), summary.trim())) >
      room.line;
  const counted = useId();
  const lineNote = useId();
  const partnerName =
    entry.section === "about" ? sectionNames.how : sectionNames.about;

  return (
    <form
      className={styles["memory-editor"]}
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onSave({
          title: title.trim(),
          summary: summary.trim(),
          text,
        }).finally(() => setSaving(false));
      }}
    >
      {named && (
        <>
          <label>
            <span>Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>Summary</span>
            <input
              value={summary}
              aria-describedby={longLine ? lineNote : undefined}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          {longLine && (
            <p id={lineNote} className={styles["memory-editor__over"]}>
              The title and summary are too long for the list the model is sent.
              Shorten one of them.
            </p>
          )}
        </>
      )}
      <label>
        <span>Text</span>
        <textarea
          value={text}
          aria-describedby={counted}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className={styles["memory-editor__foot"]}>
        <span
          id={counted}
          className={over ? styles["memory-editor__over"] : undefined}
        >
          {over
            ? `${Math.max(1, percent - 100)}% over the limit`
            : `${percent < 1 && taken > 0 ? "Under 1" : percent}% of the space${room.beside > 0 ? `, with ${partnerName}` : ""}`}
        </span>
        <button
          type="button"
          className="button button--small button--quiet"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="button button--small button--accent"
          disabled={saving || over || longLine || (named && !title.trim())}
        >
          Save
        </button>
      </div>
    </form>
  );
}
