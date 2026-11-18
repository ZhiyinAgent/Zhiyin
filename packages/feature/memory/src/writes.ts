/**
 * The writes Zhiyin can take back (ADR 0026): each change the model or the
 * person made, kept with what it replaced, so Undo, going back past a turn and
 * forgetting a conversation's entries restore what was there, unless the
 * entry changed since.
 */

import type { MemoryEntry, MemorySection } from "@zhiyin/contract";
import { holdsRule, withRule } from "./rules.js";

/** An entry as a write left it, without what changes by merely reading it. */
export type EntrySnapshot = Omit<MemoryEntry, "used">;

export type WriteRecord = (
  | {
      readonly id: string;
      readonly kind: "entry";
      readonly at: string;
      readonly number: number;
      /** Nothing for an entry the write added. */
      readonly before?: EntrySnapshot | undefined;
      /** Nothing for an entry the write removed. */
      readonly after?: EntrySnapshot | undefined;
    }
  | {
      readonly id: string;
      readonly kind: "rule";
      readonly at: string;
      readonly number: number;
      readonly scope: string;
      readonly section: MemorySection;
      /** The rule as written; nothing when the write took one out. */
      readonly rule?: string | undefined;
      /** The rule it replaced or took out. */
      readonly replaces?: string | undefined;
    }
  | {
      readonly id: string;
      readonly kind: "waiting";
      readonly at: string;
      readonly waitingId: string;
    }
) & {
  /**
   * The conversation whose card offers the write's Undo; none for a change the
   * person made on the Memory page.
   */
  readonly conversation?: string;
};

/** An entry as it stands, compared with how a write left it. */
export function snapshotOf(entry: MemoryEntry): EntrySnapshot {
  return {
    number: entry.number,
    scope: entry.scope,
    section: entry.section,
    title: entry.title,
    summary: entry.summary,
    text: entry.text,
    written: entry.written,
    ...(entry.conversation ? { conversation: entry.conversation } : {}),
    ...(entry.held ? { held: entry.held } : {}),
  };
}

/** Whether an entry is still as a write left it, in everything a person reads. */
export function unchangedSince(
  entry: MemoryEntry | undefined,
  after: EntrySnapshot | undefined,
): boolean {
  if (!entry || !after) return entry === after;
  return (
    entry.scope === after.scope &&
    entry.title === after.title &&
    entry.summary === after.summary &&
    entry.text === after.text
  );
}

/**
 * An instruction's text with a rule's write taken back: a rule added is taken
 * out, one replaced is put back, one taken out is added again. Nothing when
 * the rule was changed since.
 */
export function ruleTakenBack(
  text: string,
  write: {
    readonly rule?: string | undefined;
    readonly replaces?: string | undefined;
  },
): string | undefined {
  if (write.rule === undefined)
    return write.replaces === undefined || holdsRule(text, write.replaces)
      ? text
      : withRule(text, { rule: write.replaces });
  if (!holdsRule(text, write.rule)) return undefined;
  return withRule(text, { rule: write.replaces, replaces: write.rule });
}
