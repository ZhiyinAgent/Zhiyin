/**
 * Holding an app container still while Zhiyin works on its behalf: every
 * process of every confined run in it, in this app, is suspended while the
 * work runs, and resumed when it ends however it ends. A confined run starts
 * its program only when no hold on its container is under way, so no program
 * of the container's runs during one. Holds on one container run one at a
 * time.
 *
 * What Zhiyin checks before such work then stays as it was checked until the
 * work ends: git run for a sealed-off shell finds the folders as it looked at
 * them, since nothing in the container can change them meanwhile.
 */

import { containerName } from "./confinement.js";
import type { ProcessContainer } from "./windows.js";

/** The process containers of the confined runs under way, by container name. */
const runs = new Map<string, Set<ProcessContainer>>();
/** The last hold asked for on each container, which the next waits for. */
const queued = new Map<string, Promise<void>>();
/** The hold under way on each container, which ends when it settles. */
const holding = new Map<string, Promise<void>>();

/**
 * Counts a confined run's process container as the named container's until
 * the answer is called, so a hold suspends what it starts. Call it before
 * the run starts anything.
 */
export function enterContainer(
  name: string,
  container: ProcessContainer,
): () => void {
  const each = runs.get(name) ?? new Set();
  each.add(container);
  runs.set(name, each);
  return () => {
    each.delete(container);
    if (!each.size && runs.get(name) === each) runs.delete(name);
  };
}

/**
 * The hold under way on the named container, which settles when it ends, or
 * nothing. A run waits on each until this answers nothing, then starts its
 * program at once, with no wait in between, so no hold begins after the last
 * look and before the program is in its run's process container.
 */
export function containerHold(name: string): Promise<void> | undefined {
  return holding.get(name);
}

/**
 * Runs `work` with every process of the container a home's runs of
 * `purpose` share suspended, and resumes them when it settles, also when it
 * throws or is stopped. Rejects, running nothing, when one of them cannot be
 * suspended.
 */
export async function holdingContainer<T>(
  purpose: string,
  home: string,
  work: () => Promise<T>,
): Promise<T> {
  const name = containerName(purpose, home);
  const before = queued.get(name) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const after = before.then(() => mine);
  queued.set(name, after);
  await before;
  holding.set(name, mine);
  const suspended: { resume(): void }[] = [];
  try {
    for (const container of runs.get(name) ?? []) {
      if (!container.suspend)
        throw new Error("This container's processes cannot be suspended.");
      suspended.push(container.suspend());
    }
    return await work();
  } finally {
    for (const each of suspended) each.resume();
    if (holding.get(name) === mine) holding.delete(name);
    if (queued.get(name) === after) queued.delete(name);
    release();
  }
}
