/**
 * One document kept as a file that only grows.
 *
 * The file starts with the document's whole state on one line, and each save
 * adds one line holding that save's edits, so a save costs what changed rather
 * than what exists. A line is a whole save or nothing: a save cut off by a
 * crash leaves a broken last line, which is dropped when the file is read and
 * reported, and a failed append is cut back off before anything else is
 * written. Every append is flushed to the disk before it counts as saved.
 *
 * When the edits outgrow the state they describe, a fresh file holding only
 * the state replaces the old one. The fresh file is written in full under
 * another name and then renamed, so there is always one complete file to read.
 */

import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  truncate,
} from "node:fs/promises";
import { join } from "node:path";
import { applyChanges, type HistoryChange } from "./history-changes.js";

/** The file operations a log makes, replaced by tests that make them fail. */
export type HistoryFiles = {
  /** The file's bytes, or nothing if there is no such file. */
  readonly read: (path: string) => Promise<Buffer | undefined>;
  readonly names: (folder: string) => Promise<readonly string[]>;
  /** Adds to the end of the file, and returns once it is on the disk. */
  readonly append: (path: string, text: string) => Promise<void>;
  readonly truncate: (path: string, bytes: number) => Promise<void>;
  /** Writes a whole file under another name, then renames it into place. */
  readonly create: (path: string, text: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
};

async function durably(
  path: string,
  flags: "a" | "w",
  text: string,
): Promise<void> {
  const handle = await open(path, flags);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export const historyFiles: HistoryFiles = {
  read: async (path) => {
    try {
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  names: async (folder) => {
    try {
      return await readdir(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  },
  append: (path, text) => durably(path, "a", text),
  truncate: (path, bytes) => truncate(path, bytes),
  create: async (path, text) => {
    await mkdir(join(path, ".."), { recursive: true });
    const temporary = `${path}.tmp`;
    try {
      await durably(temporary, "w", text);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  },
  remove: (path) => rm(path, { force: true }),
};

/** Below this, a log is never worth starting afresh. */
const smallestRestart = 64 * 1024;

const segmentName = /^log-(\d{6})\.jsonl$/;

function nameOf(segment: number): string {
  return `log-${String(segment).padStart(6, "0")}.jsonl`;
}

/** The log files in a folder, newest first. */
async function segmentsIn(
  folder: string,
  files: HistoryFiles,
): Promise<number[]> {
  return (await files.names(folder))
    .map((name) => segmentName.exec(name)?.[1])
    .filter((number): number is string => number !== undefined)
    .map(Number)
    .sort((a, b) => b - a);
}

function stateLine(state: unknown): string {
  return `${JSON.stringify({ state })}\n`;
}

/** What reading a log found. */
export type ReadHistoryLog = {
  readonly state: unknown;
  /** Whether a save cut off by a crash was dropped. */
  readonly lost: boolean;
  readonly log: HistoryLog;
};

/** Every line of a file, with where each one ends in bytes. */
function linesOf(bytes: Buffer): { text: string; end: number }[] {
  const lines: { text: string; end: number }[] = [];
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline < 0 ? bytes.length : newline + 1;
    lines.push({
      text: bytes.subarray(start, newline < 0 ? end : newline).toString("utf8"),
      end: newline < 0 ? -1 : end,
    });
    start = end;
  }
  return lines;
}

function parsed(line: { text: string; end: number }): unknown {
  if (line.end < 0) return undefined;
  try {
    return JSON.parse(line.text) as unknown;
  } catch {
    return undefined;
  }
}

function replay(bytes: Buffer): {
  state: unknown;
  lost: boolean;
  goodBytes: number;
} {
  const lines = linesOf(bytes);
  const first = parsed(lines[0] ?? { text: "", end: -1 });
  if (!first || typeof first !== "object" || !("state" in first))
    throw new Error("The log does not start with a saved state.");
  let state = first.state;
  let goodBytes = lines[0]!.end;
  for (let index = 1; index < lines.length; index += 1) {
    const line = parsed(lines[index]!);
    if (
      !line ||
      typeof line !== "object" ||
      !("changes" in line) ||
      !Array.isArray(line.changes)
    ) {
      // A broken line is a save cut off by a crash only if nothing follows it.
      if (lines.slice(index + 1).some((later) => parsed(later) !== undefined))
        throw new Error("A saved change in the middle of the log is damaged.");
      return { state, lost: true, goodBytes };
    }
    state = applyChanges(state, line.changes as HistoryChange[]);
    goodBytes = lines[index]!.end;
  }
  return { state, lost: false, goodBytes };
}

export class HistoryLog {
  readonly #folder: string;
  readonly #files: HistoryFiles;
  #segment: number;
  /** Where the last whole save ends. Anything after it is not a save. */
  #bytes: number;
  /** Whether the file may hold something past `#bytes` to cut off first. */
  #tail: boolean;
  /** Whether a failed append may have left a partial line that could not be cut off. */
  #uncertain = false;
  /** The size of the state when it was last measured. */
  #stateBytes: number;

  private constructor(
    folder: string,
    files: HistoryFiles,
    segment: number,
    bytes: number,
    tail: boolean,
    stateBytes: number,
  ) {
    this.#folder = folder;
    this.#files = files;
    this.#segment = segment;
    this.#bytes = bytes;
    this.#tail = tail;
    this.#stateBytes = stateBytes;
  }

  /** Whether the folder holds a log at all. */
  static async exists(
    folder: string,
    files: HistoryFiles = historyFiles,
  ): Promise<boolean> {
    return (await segmentsIn(folder, files)).length > 0;
  }

  /**
   * A log holding only this state. Whatever the folder held before is
   * replaced: the new file is numbered above it, so it is the one read.
   */
  static async create(
    folder: string,
    state: unknown,
    files: HistoryFiles = historyFiles,
  ): Promise<HistoryLog> {
    const earlier = await segmentsIn(folder, files);
    const segment = (earlier[0] ?? 0) + 1;
    const line = stateLine(state);
    await files.create(join(folder, nameOf(segment)), line);
    await Promise.all(
      earlier.map((number) =>
        files.remove(join(folder, nameOf(number))).catch(() => undefined),
      ),
    );
    const bytes = Buffer.byteLength(line, "utf8");
    return new HistoryLog(folder, files, segment, bytes, false, bytes);
  }

  /** The newest complete file in the folder, replayed. */
  static async open(
    folder: string,
    files: HistoryFiles = historyFiles,
  ): Promise<ReadHistoryLog> {
    const newest = (await segmentsIn(folder, files))[0];
    if (newest === undefined) throw new Error("The folder holds no log.");
    const bytes = await files.read(join(folder, nameOf(newest)));
    if (!bytes) throw new Error("The log could not be read.");
    const { state, lost, goodBytes } = replay(bytes);
    const firstLine = bytes.indexOf(0x0a) + 1;
    return {
      state,
      lost,
      log: new HistoryLog(
        folder,
        files,
        newest,
        goodBytes,
        goodBytes < bytes.length,
        firstLine,
      ),
    };
  }

  get #path(): string {
    return join(this.#folder, nameOf(this.#segment));
  }

  /**
   * Adds one save's edits. `state` is the document once they are applied: it
   * becomes the whole content of a fresh file when the edits outgrow it.
   */
  async write(
    changes: readonly HistoryChange[],
    state: unknown,
  ): Promise<void> {
    if (!changes.length) return;
    if (this.#uncertain) return this.#restart(state);
    if (this.#tail) {
      await this.#files.truncate(this.#path, this.#bytes);
      this.#tail = false;
    }
    const line = `${JSON.stringify({ changes })}\n`;
    try {
      await this.#files.append(this.#path, line);
    } catch (error) {
      await this.#files.truncate(this.#path, this.#bytes).catch(() => {
        this.#uncertain = true;
      });
      throw error;
    }
    this.#bytes += Buffer.byteLength(line, "utf8");
    if (this.#bytes <= Math.max(4 * this.#stateBytes, smallestRestart)) return;
    this.#stateBytes = Buffer.byteLength(stateLine(state), "utf8");
    if (this.#bytes > Math.max(4 * this.#stateBytes, smallestRestart))
      await this.#restart(state);
  }

  /** A fresh file holding only this state, and the old one gone. */
  async #restart(state: unknown): Promise<void> {
    const line = stateLine(state);
    const previous = this.#path;
    await this.#files.create(
      join(this.#folder, nameOf(this.#segment + 1)),
      line,
    );
    this.#segment += 1;
    this.#bytes = Buffer.byteLength(line, "utf8");
    this.#stateBytes = this.#bytes;
    this.#tail = false;
    this.#uncertain = false;
    await this.#files.remove(previous).catch(() => undefined);
  }
}
