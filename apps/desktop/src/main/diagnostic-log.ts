/**
 * What is left behind for finding out what went wrong on a person's computer.
 *
 * One JSON line per event, in a file per day, kept for two weeks. It stays on
 * this computer: nothing here sends anything anywhere. Entries are stored as
 * written, like the saved history beside them.
 *
 * Written synchronously, so an entry recorded as the process fails is on disk
 * before anything else can happen. It never throws: a log that cannot be
 * written must not turn a problem into a crash.
 */

import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import type { EventEmitter } from "node:events";
import { join } from "node:path";

export type LogEntry = {
  readonly level: "error" | "warn" | "info";
  /** The part of the app it is about. */
  readonly source: string;
  readonly message: string;
  readonly error?: unknown;
};

const keptDays = 14;
const dayMs = 24 * 60 * 60 * 1000;
const dayFile = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

function described(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };
}

export class DiagnosticLog {
  readonly #folder: string;
  readonly #now: () => Date;

  constructor(folder: string, now: () => Date = () => new Date()) {
    this.#folder = folder;
    this.#now = now;
  }

  record(entry: LogEntry): void {
    const time = this.#now().toISOString();
    const line = JSON.stringify({
      time,
      level: entry.level,
      source: entry.source,
      message: entry.message,
      ...(entry.error === undefined ? {} : { error: described(entry.error) }),
    });
    try {
      mkdirSync(this.#folder, { recursive: true });
      appendFileSync(
        join(this.#folder, `${time.slice(0, 10)}.jsonl`),
        `${line}\n`,
        "utf8",
      );
    } catch {
      // Nowhere to say it; the app carries on without the entry.
    }
  }

  /** Removes the days older than two weeks, and nothing else in the folder. */
  prune(): void {
    const oldest = new Date(this.#now().getTime() - keptDays * dayMs)
      .toISOString()
      .slice(0, 10);
    try {
      for (const name of readdirSync(this.#folder)) {
        const day = dayFile.exec(name)?.[1];
        if (day && day < oldest)
          rmSync(join(this.#folder, name), { force: true });
      }
    } catch {
      // No folder yet, or one that cannot be read: nothing to remove.
    }
  }
}

/**
 * Records what the main process throws and does not catch, or rejects and does
 * not handle, and leaves it running: the window and the saved history are
 * still there, and a person reopening the app loses more than one that lost a
 * single operation.
 */
export function recordCrashes(main: EventEmitter, log: DiagnosticLog): void {
  main.on("uncaughtException", (error: unknown) =>
    log.record({
      level: "error",
      source: "main",
      message: "An exception was not caught.",
      error,
    }),
  );
  main.on("unhandledRejection", (reason: unknown) =>
    log.record({
      level: "error",
      source: "main",
      message: "A rejected promise was not handled.",
      error: reason,
    }),
  );
}
