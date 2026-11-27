/**
 * What writes permissions in this session of the app: folder grants, and
 * paths held against sealed-off programs. Windows hands a folder's grant on
 * to everything in it on a thread of its own, so a path held while a grant
 * walks could be written over by the walk; each waits for the other instead.
 */

import { inside } from "@zhiyin/path-comparison";

/** Work in the queue: what it does, and the folder it walks, for a grant. */
type Work = { readonly start: () => Promise<void>; readonly folder?: string };

/** Whether either folder holds the other. */
const overlap = (one: string, other: string) =>
  inside(one, other) || inside(other, one);

/**
 * Work written one at a time, since each holds a thread file work shares
 * while it walks, with one exception: a grant a run waits for walks beside a
 * grant of a folder it does not overlap, two at most, since neither writes
 * what the other does. Work a run waits on goes before work written behind a
 * run, though not before work already walking, and otherwise in the order it
 * was asked for.
 */
export class Walks {
  readonly #awaited: Work[] = [];
  readonly #behind: Work[] = [];
  readonly #walking = new Set<Work>();

  /** `folder` is the folder a grant walks; other work names none. */
  run<T>(
    work: () => Promise<T>,
    awaited: boolean,
    folder?: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      (awaited ? this.#awaited : this.#behind).push({
        start: () => work().then(resolve, reject),
        ...(folder === undefined ? {} : { folder }),
      });
      this.#next();
    });
  }

  /** Whether the first work waiting may start beside what walks now. */
  #mayStart(work: Work, awaited: boolean): boolean {
    if (this.#walking.size === 0) return true;
    const { folder } = work;
    if (!awaited || folder === undefined || this.#walking.size >= 2)
      return false;
    return [...this.#walking].every(
      (walking) =>
        walking.folder !== undefined && !overlap(walking.folder, folder),
    );
  }

  #next(): void {
    for (;;) {
      const awaited = this.#awaited.length > 0;
      const queue = awaited ? this.#awaited : this.#behind;
      const work = queue[0];
      if (!work || !this.#mayStart(work, awaited)) return;
      queue.shift();
      this.#walking.add(work);
      void work.start().finally(() => {
        this.#walking.delete(work);
        this.#next();
      });
    }
  }
}

/** The one queue of this session of the app. */
export const sessionWalks = new Walks();

/** Paths held against sealed-off programs now, by their name in lower case. */
const held = new Map<
  string,
  { folder: boolean; tree: boolean; count: number }
>();

const named = (path: string) => path.toLowerCase();

/** Marks a path held, once more; `tree` when what it holds is held with it. */
export function markHeld(path: string, folder: boolean, tree = false): void {
  const key = named(path);
  const entry = held.get(key);
  if (entry) {
    entry.count += 1;
    entry.tree ||= tree;
  } else held.set(key, { folder, tree, count: 1 });
}

/** Lets go of one mark of a path. */
export function unmarkHeld(path: string): void {
  const key = named(path);
  const entry = held.get(key);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count <= 0) held.delete(key);
}

/**
 * Whether a path is held, whether it is a folder, and whether what it holds
 * is held with it: a grant writes nothing to it, and goes through a held
 * folder to what it holds, but never into a held tree.
 */
export function heldNow(
  path: string,
): { readonly folder: boolean; readonly tree: boolean } | undefined {
  return held.get(named(path));
}
