/**
 * The corrections log's fake, for the tests of the packages above it (ADR 0002).
 * It writes nowhere: it keeps what it is given in memory, and reads it back as
 * the log on disk does.
 */

import type { CorrectionEntry, CorrectionsLog } from "../src/index.js";

export type FakeCorrectionsLog = CorrectionsLog & {
  /** Every entry recorded so far, oldest first. */
  readonly entries: readonly CorrectionEntry[];
};

/**
 * A log kept in memory. `record`, when given, answers each record in its
 * place, as a log that cannot be written does; nothing is then kept.
 */
export function fakeCorrectionsLog(
  answers: {
    readonly record?: (entry: CorrectionEntry) => Promise<void>;
  } = {},
): FakeCorrectionsLog {
  const entries: CorrectionEntry[] = [];
  return {
    entries,
    record:
      answers.record ??
      (async (entry) => {
        entries.push(entry);
      }),
    read: async () => [...entries],
  };
}
