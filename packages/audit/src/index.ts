/**
 * A durable record of the corrections that deliberately never reach the
 * transcript.
 *
 * ADRs 0014 and 0016 made a whole class of event invisible: a tool refuses a
 * call as model-correctable, and either the model or a small repair model fixes
 * it without anyone being told. That is the right behaviour for a person trying
 * to get work done, and it leaves nothing at all behind — which means a model
 * that fails the same way every time, or a repair that is rejected for altering
 * protected content, cannot be seen from inside the app.
 *
 * This is where those events go instead. It is written for someone asking what
 * actually happened, after the fact: what was refused, what was proposed in its
 * place, and — when a repair was thrown away — precisely why.
 *
 * It is not a second transcript. Nothing here is shown to the person during
 * their work, and nothing here is sent to a model.
 *
 * Boundaries and invariants: docs/architecture/features/audit/README.md
 */

import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

/** Why a proposed repair was thrown away. Each is a distinct finding. */
export type RepairRejection =
  | "handover"
  | "content-changed"
  | "no-progress"
  | "still-refused"
  | "unusable-answer"
  | "too-large"
  | "out-of-room";

export type AuditEntry = {
  /** ISO timestamp, supplied by the caller so tests are not time-dependent. */
  readonly at: string;
  readonly taskId: string;
  readonly toolName: string;
  readonly kind: "quiet-retry" | "repair-applied" | "repair-rejected";
  /** The tool's refusal, already bounded and redacted by the caller. */
  readonly reason: string;
  readonly cause?: RepairRejection;
  /** Arguments as refused, and as repaired. Bounded by the caller. */
  readonly before?: string;
  readonly after?: string;
};

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
  /** Most recent last, so the file reads in the order things happened. */
  read(limit?: number): Promise<readonly AuditEntry[]>;
  clear(): Promise<void>;
  retentionLimit(): number;
}

export const maximumAuditEntries = 5_000;

function isEntry(value: unknown): value is AuditEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["at"] === "string" &&
    typeof entry["taskId"] === "string" &&
    typeof entry["toolName"] === "string" &&
    typeof entry["reason"] === "string" &&
    (entry["kind"] === "quiet-retry" ||
      entry["kind"] === "repair-applied" ||
      entry["kind"] === "repair-rejected")
  );
}

/**
 * One line of JSON per entry, appended.
 *
 * Append is the whole point: an audit record that is rewritten on every write
 * can lose earlier entries to a single bad write, and the earlier entries are
 * the ones being kept. Trimming happens rarely and separately.
 */
export class FileAuditLog implements AuditLog {
  readonly #directory: string;
  readonly #file: string;
  #writes: Promise<unknown> = Promise.resolve();
  #sinceTrim = 0;

  constructor(directory: string) {
    this.#directory = directory;
    this.#file = join(directory, "corrections.log");
  }

  async record(entry: AuditEntry): Promise<void> {
    const write = this.#writes.then(() => this.#append(entry));
    this.#writes = write.catch(() => undefined);
    return write;
  }

  async #append(entry: AuditEntry): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await appendFile(this.#file, `${JSON.stringify(entry)}\n`, "utf8");
    this.#sinceTrim += 1;
    // Checked occasionally rather than on every write: reading the whole file
    // back to count lines on each append would make the common case expensive.
    if (this.#sinceTrim >= 500) {
      this.#sinceTrim = 0;
      await this.#trim();
    }
  }

  /**
   * Keeps the newest entries and drops the oldest. Bounding an audit log is a
   * retention decision made here by default because unbounded growth is worse;
   * the product-level rule does not exist yet.
   */
  async #trim(): Promise<void> {
    const entries = await this.read();
    if (entries.length <= maximumAuditEntries) return;
    const kept = entries.slice(-maximumAuditEntries);
    const temporary = `${this.#file}.tmp`;
    await writeFile(
      temporary,
      `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
    await rename(temporary, this.#file);
  }

  async read(limit?: number): Promise<readonly AuditEntry[]> {
    let source: string;
    try {
      source = await readFile(this.#file, "utf8");
    } catch {
      return [];
    }
    const entries: AuditEntry[] = [];
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
    return limit === undefined ? entries : entries.slice(-limit);
  }

  async clear(): Promise<void> {
    const removal = this.#writes.then(() => rm(this.#file, { force: true }));
    this.#writes = removal.catch(() => undefined);
    await removal;
    this.#sinceTrim = 0;
  }

  retentionLimit(): number {
    return maximumAuditEntries;
  }
}
