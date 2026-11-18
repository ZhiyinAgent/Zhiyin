import { mkdir, readFile } from "node:fs/promises";
import { appendLine, replaceFile } from "@zhiyin/files";
import { Serial } from "@zhiyin/one-at-a-time";
import { join } from "node:path";

export type CorrectionEntry = {
  /** ISO timestamp, supplied by the caller so tests are not time-dependent. */
  readonly at: string;
  readonly taskId: string;
  readonly toolName: string;
  /**
   * `input-corrected`: a fix that cannot change a value made the input
   * readable. `quiet-retry`: the model alone was told why its call was
   * refused.
   */
  readonly kind: "quiet-retry" | "input-corrected";
  /** What was wrong, already bounded and redacted by the caller. */
  readonly reason: string;
  /** Arguments as they arrived, and as fixed. Bounded by the caller. */
  readonly before?: string;
  readonly after?: string;
  /**
   * For a call its tool looked at and refused: how many of that tool's calls
   * in a row the model has now had refused in the turn, this one included. 1
   * is the first since the tool last ran.
   */
  readonly inRow?: number;
};

export interface CorrectionsLog {
  record(entry: CorrectionEntry): Promise<void>;
  /** Most recent last, so the file reads in the order things happened. */
  read(): Promise<readonly CorrectionEntry[]>;
}

export const maximumCorrectionEntries = 5_000;

function isEntry(value: unknown): value is CorrectionEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["at"] === "string" &&
    typeof entry["taskId"] === "string" &&
    typeof entry["toolName"] === "string" &&
    typeof entry["reason"] === "string" &&
    (entry["kind"] === "quiet-retry" || entry["kind"] === "input-corrected")
  );
}

/**
 * One line of JSON per entry, appended.
 *
 * Append is the whole point: a record that is rewritten on every write can
 * lose earlier entries to a single bad write, and the earlier entries are the
 * ones being kept. Trimming happens rarely and separately.
 */
export class FileCorrectionsLog implements CorrectionsLog {
  readonly #directory: string;
  readonly #file: string;
  readonly #writes = new Serial();
  #sinceTrim = 0;
  /** Whether this run has trimmed what earlier runs left. */
  #checked = false;

  constructor(directory: string) {
    this.#directory = directory;
    this.#file = join(directory, "corrections.log");
  }

  async record(entry: CorrectionEntry): Promise<void> {
    return this.#writes.run(() => this.#append(entry));
  }

  async #append(entry: CorrectionEntry): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await appendLine(this.#file, JSON.stringify(entry));
    this.#sinceTrim += 1;
    // The first record of a run trims a log past its limit, however few
    // entries each run adds. After that it is checked occasionally rather
    // than on every write: reading the whole file back to count lines on each
    // append would make the common case expensive.
    const first = !this.#checked;
    this.#checked = true;
    if (this.#sinceTrim >= 500) {
      this.#sinceTrim = 0;
      await this.#trim();
    } else if (first) await this.#trim();
  }

  /** Keeps the newest entries and drops the oldest (ADR 0025). */
  async #trim(): Promise<void> {
    const entries = await this.read();
    if (entries.length <= maximumCorrectionEntries) return;
    const kept = entries.slice(-maximumCorrectionEntries);
    await replaceFile(
      this.#file,
      `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );
  }

  async read(): Promise<readonly CorrectionEntry[]> {
    let source: string;
    try {
      source = await readFile(this.#file, "utf8");
    } catch {
      return [];
    }
    const entries: CorrectionEntry[] = [];
    for (const line of source.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        // A damaged line is skipped rather than discarding the whole record.
        if (isEntry(parsed)) entries.push(parsed);
      } catch {
        continue;
      }
    }
    return entries;
  }
}
