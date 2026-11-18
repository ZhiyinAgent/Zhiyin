import { useId, useState } from "react";
import type {
  MemoryChange,
  MemoryOutcome,
  MemoryRequest,
} from "@zhiyin/contract";
import { Icon, PointedTip } from "../shared/index.js";
import { waitingWords } from "./memory.js";
import { sectionNames } from "./memoryWords.js";
import styles from "./memory.module.css";

const icons = {
  added: "plus",
  changed: "pencil",
  removed: "trash",
  waiting: "clock",
} as const;

/** A change on the card; one the look back made says it came after the turn. */
export type TurnMemoryChange = MemoryChange & { readonly afterTurn?: true };

/**
 * What a turn kept in memory: a quiet card under the turn, like the files it
 * changed. The header says how much, each row what and where, with the way
 * back beside it. A change that waits for the person says why on its "i",
 * and is kept or discarded there.
 */
export function TurnMemory({
  changes,
  onOpen,
  onChange,
}: {
  changes: readonly TurnMemoryChange[];
  /** Opens an entry on the Memory page. */
  onOpen: (number: number) => void;
  /** Asks the core for a change; a refusal says why. */
  onChange: (request: MemoryRequest) => Promise<MemoryOutcome>;
}) {
  const headingId = useId();
  const [failure, setFailure] = useState("");
  const change = (request: MemoryRequest) => {
    setFailure("");
    void onChange(request).then(
      (outcome) => !outcome.ok && setFailure(outcome.reason),
      (cause: unknown) =>
        setFailure(
          cause instanceof Error
            ? cause.message
            : "The change was not made. Try again.",
        ),
    );
  };
  return (
    <section className={styles["turn-memory"]} aria-labelledby={headingId}>
      <header className={styles["turn-memory__header"]}>
        <Icon name="spark" />
        <h3 id={headingId}>Memory</h3>
        <span className={styles["turn-memory__counts"]}>{counts(changes)}</span>
      </header>
      <ul
        className={styles["turn-memory__rows"]}
        aria-label="Changes to memory"
      >
        {changes.map((one) => (
          <ChangeRow
            key={one.writeId}
            change={one}
            onOpen={onOpen}
            onUndo={() => change({ kind: "undo", writeId: one.writeId })}
            onKeep={(waitingId) => change({ kind: "keep", waitingId })}
            onDiscard={(waitingId) => change({ kind: "discard", waitingId })}
          />
        ))}
      </ul>
      {failure && (
        <p className={styles["turn-memory__failure"]} role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}

function ChangeRow({
  change,
  onOpen,
  onUndo,
  onKeep,
  onDiscard,
}: {
  change: TurnMemoryChange;
  onOpen: (number: number) => void;
  onUndo: () => void;
  onKeep: (waitingId: string) => void;
  onDiscard: (waitingId: string) => void;
}) {
  const waits = change.change === "waiting" && !change.state;
  const where = `${change.scopeName} · ${sectionNames[change.section]}${change.afterTurn ? " · after the turn" : ""}`;
  const number = change.number;
  return (
    <li className={styles["turn-memory__row"]}>
      <span
        className={`${styles["turn-memory__kind"]} ${styles[`turn-memory__kind--${change.change}`]}`}
      >
        <Icon name={icons[change.change]} />
      </span>
      {change.change === "removed" || number === undefined ? (
        <span className={styles["turn-memory__title"]}>{change.title}</span>
      ) : (
        <button
          type="button"
          className={styles["turn-memory__title"]}
          onClick={() => onOpen(number)}
        >
          {change.title}
        </button>
      )}
      <span className={styles["turn-memory__note"]}>
        {note(change, where)}
        {waits && change.waiting && (
          <WhyItWaits because={change.waiting.because} />
        )}
      </span>
      {!change.state && change.change !== "waiting" && (
        <button type="button" className="text-button" onClick={onUndo}>
          Undo
        </button>
      )}
      {waits && change.waiting && (
        <div className={styles["turn-memory__waiting"]}>
          <p>{waitingWords(change.waiting)}</p>
          <span>
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => onDiscard(change.waiting!.id)}
            >
              Discard
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => onKeep(change.waiting!.id)}
            >
              Keep
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

/** What the row says beside its title. */
function note(change: MemoryChange, where: string): string {
  if (change.state === "undone") return "Undone";
  if (change.state === "kept") return "Kept";
  if (change.state === "discarded") return "Discarded";
  if (change.change === "waiting") return "Waiting for you";
  if (change.change === "removed" && change.mergedInto !== undefined)
    return `Merged into #${change.mergedInto}`;
  return where;
}

/**
 * "1 new · 2 changed": what the turn did, in the order it matters, and what
 * of it was undone since.
 */
function counts(changes: readonly MemoryChange[]): string {
  let added = 0;
  let changed = 0;
  let removed = 0;
  let waiting = 0;
  let undone = 0;
  for (const change of changes) {
    if (change.state === "undone") undone += 1;
    else if (change.change === "added") added += 1;
    else if (change.change === "changed") changed += 1;
    else if (change.change === "removed") removed += 1;
    else if (!change.state) waiting += 1;
    else if (change.state === "kept") changed += 1;
  }
  return [
    added ? `${added} new` : "",
    changed ? `${changed} changed` : "",
    removed ? `${removed} removed` : "",
    waiting ? `${waiting} waiting for you` : "",
    undone ? `${undone} undone` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Why a change waits, on an "i" as the approval cards explain why they ask. */
function WhyItWaits({ because }: { because: string }) {
  return (
    <PointedTip label="Why it waits" className={styles["turn-memory__about"]}>
      This conversation read {because}, so a change to how Zhiyin works waits
      until you keep it.
    </PointedTip>
  );
}
