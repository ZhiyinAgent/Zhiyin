/**
 * What writes permissions in this session of the app, one write at a time:
 * folder grants, and paths held against sealed-off programs. Windows hands a
 * folder's grant on to everything in it on a thread of its own, so a path
 * held while a grant walks could be written over by the walk; each waits for
 * the other instead.
 */

/**
 * Work written one at a time, since each holds a thread file work shares
 * while it walks. Work a run waits on goes before work written behind a run,
 * though not before work already walking.
 */
export class Walks {
  readonly #awaited: (() => Promise<void>)[] = [];
  readonly #behind: (() => Promise<void>)[] = [];
  #walking = false;

  run<T>(work: () => Promise<T>, awaited: boolean): Promise<T> {
    return new Promise((resolve, reject) => {
      (awaited ? this.#awaited : this.#behind).push(() =>
        work().then(resolve, reject),
      );
      void this.#next();
    });
  }

  async #next(): Promise<void> {
    if (this.#walking) return;
    this.#walking = true;
    try {
      for (
        let work = this.#awaited.shift() ?? this.#behind.shift();
        work;
        work = this.#awaited.shift() ?? this.#behind.shift()
      )
        await work();
    } finally {
      this.#walking = false;
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
