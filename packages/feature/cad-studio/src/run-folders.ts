/**
 * The folders each run keeps its files in, in the conversation's own folder,
 * gone when the run ends.
 */

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * A run's folder removed once the call has its answer. Windows can hold a
 * confined run's profile for a moment after it ends: the removal is tried
 * again, and a folder still held stays in the conversation's own folder,
 * which goes with the conversation, rather than turning the call's own
 * answer into an error about the folder.
 */
export async function removeRun(run: string) {
  await rm(run, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  }).catch(() => undefined);
}

/**
 * Tries again to remove each run folder in `runs` that no call is using, as
 * `using` names them: a folder Windows held when its run ended goes once it
 * is let go, so a long conversation does not collect them.
 */
export async function removeHeldRuns(runs: string, using: ReadonlySet<string>) {
  const left = await readdir(runs).catch(() => []);
  await Promise.all(
    left
      .map((name) => join(runs, name))
      .filter((run) => !using.has(run))
      .map(removeRun),
  );
}
