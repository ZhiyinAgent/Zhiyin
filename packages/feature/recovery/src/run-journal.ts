/**
 * The journal of runs in copied folders. The copy taken for a run is written
 * down before the run starts, so a run Zhiyin stopped with is still found at
 * the next start; a run that ends while an earlier one in its folder goes on
 * is written down in its place, as what it recorded, until no run needs it.
 * Each is written whole, under a name its own copy's id decides.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { JournalPoint } from "@zhiyin/file-watch";
import { replaceFile } from "@zhiyin/files";
import type { Known, RunCopy } from "./run-changes.js";

/** A copy taken for an action that has not run yet, or is running. */
export type Pending = RunCopy & {
  readonly actionId: string;
  /** A folder outside the workspace, rather than the workspace. */
  readonly outside: boolean;
  /** Folders inside it that are not its to copy, as the workspace is not an outside folder's. */
  readonly without: readonly string[];
  readonly conversationId: string;
  /** Why each file not copied was not. */
  readonly uncopied: ReadonlyMap<string, string>;
  /** Whether it was taken as the run began, rather than before approval. */
  readonly begun: boolean;
  /** Where the drive's change journal stood as the copy was taken. */
  readonly point?: JournalPoint;
};

/** A run that ended while an earlier one in its folder went on. */
export type Ended = RunCopy & {
  readonly actionId: string;
  readonly outside: boolean;
};

/**
 * A copy taken for a run, as written down before the run starts; or, once
 * the run ended while an earlier one in its folder went on, what it recorded
 * and those files as its copy found them.
 */
type WrittenRun =
  | {
      readonly version: 1;
      readonly actionId: string;
      readonly conversationId: string;
      readonly root: string;
      readonly outside?: true;
      readonly without?: readonly string[];
      readonly seq: number;
      readonly begun?: true;
      readonly point?: JournalPoint;
      readonly files: readonly (readonly [string, Known])[];
      readonly uncopied: readonly (readonly [string, string])[];
    }
  | {
      readonly version: 1;
      readonly actionId: string;
      readonly root: string;
      readonly outside?: true;
      readonly seq: number;
      readonly ended: true;
      readonly files: readonly (readonly [string, Known])[];
      readonly recorded: readonly string[];
    };

/**
 * How one copy of an action is named: the workspace's by the action alone,
 * a folder outside it by the action and the folder.
 */
export const copyId = (actionId: string, root: string, outside: boolean) =>
  outside ? `${actionId}\n${root.toLowerCase()}` : actionId;

/** The id of the copy a written run is of. */
export const idOf = (run: WrittenRun) =>
  copyId(run.actionId, run.root, run.outside === true);

const isPairs = (value: unknown) =>
  Array.isArray(value) &&
  value.every((pair) => Array.isArray(pair) && typeof pair[0] === "string");

/** Whether what was read is a run as written down, of either kind. */
function isWrittenRun(value: unknown): value is WrittenRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Record<string, unknown>;
  if (
    run.version !== 1 ||
    typeof run.actionId !== "string" ||
    typeof run.root !== "string" ||
    typeof run.seq !== "number" ||
    (run.outside !== undefined && run.outside !== true) ||
    !isPairs(run.files)
  )
    return false;
  return run.ended === true
    ? Array.isArray(run.recorded) &&
        run.recorded.every((path) => typeof path === "string")
    : typeof run.conversationId === "string" &&
        isPairs(run.uncopied) &&
        (run.without === undefined ||
          (Array.isArray(run.without) &&
            run.without.every((path) => typeof path === "string")));
}

export class RunJournal {
  readonly #folder: string;

  constructor(folder: string) {
    this.#folder = folder;
  }

  /** Writes down the copy taken for a run, before the run can start. */
  async write(id: string, pending: Pending): Promise<void> {
    await this.#replace(id, {
      version: 1,
      actionId: pending.actionId,
      conversationId: pending.conversationId,
      root: pending.root,
      ...(pending.outside ? { outside: true as const } : {}),
      ...(pending.without.length ? { without: [...pending.without] } : {}),
      seq: pending.seq,
      ...(pending.begun ? { begun: true as const } : {}),
      ...(pending.point ? { point: pending.point } : {}),
      files: [...pending.files],
      uncopied: [...pending.uncopied],
    });
  }

  /** Writes down what a run that ended recorded, in place of its copy. */
  async writeEnded(ended: Ended): Promise<void> {
    await this.#replace(copyId(ended.actionId, ended.root, ended.outside), {
      version: 1,
      actionId: ended.actionId,
      root: ended.root,
      ...(ended.outside ? { outside: true as const } : {}),
      seq: ended.seq,
      ended: true,
      files: [...ended.files],
      recorded: [...(ended.recorded ?? [])],
    });
  }

  async remove(id: string): Promise<void> {
    await rm(this.#file(id), { force: true });
  }

  /**
   * Every run written down, oldest first. One unreadable, or not a run's,
   * was never begun, and goes by its own name.
   */
  async read(): Promise<WrittenRun[]> {
    let names: string[];
    try {
      names = await readdir(this.#folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const found: WrittenRun[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const run = await readFile(join(this.#folder, name), "utf8")
        .then((text) => JSON.parse(text) as unknown)
        .catch(() => undefined);
      if (isWrittenRun(run) && name === this.#name(idOf(run))) found.push(run);
      else await rm(join(this.#folder, name), { force: true });
    }
    return found.sort((a, b) => a.seq - b.seq);
  }

  async #replace(id: string, written: WrittenRun): Promise<void> {
    await mkdir(this.#folder, { recursive: true });
    await replaceFile(this.#file(id), JSON.stringify(written));
  }

  /** Where a copy is written down, by its id. */
  #file(id: string): string {
    return join(this.#folder, this.#name(id));
  }

  #name(id: string): string {
    return `${createHash("sha256").update(id).digest("hex")}.json`;
  }
}
