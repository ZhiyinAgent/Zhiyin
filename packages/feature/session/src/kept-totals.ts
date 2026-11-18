/**
 * What one kind of kept item holds, in memory: each item's size and when it
 * was kept, and each removal note's age. The folder is read once, the first
 * time the kind is kept to, and then followed as items come and go, so
 * keeping one more picture costs the same in a store of thousands as in an
 * empty one.
 */

import { readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";

type Item = { readonly bytes: number; readonly at: number };

export class KeptTotals {
  readonly #items = new Map<string, Item>();
  readonly #notes = new Map<string, number>();

  private constructor() {}

  /** Reads a kind's folder: one folder per conversation, items and notes in each. */
  static async read(
    folder: string,
    isNote: (name: string) => boolean,
  ): Promise<KeptTotals> {
    const totals = new KeptTotals();
    const owners = await readdir(folder).catch(() => [] as string[]);
    await Promise.all(
      owners.map(async (owner) => {
        const names = await readdir(join(folder, owner)).catch(
          () => [] as string[],
        );
        await Promise.all(
          names.map(async (name) => {
            const path = join(folder, owner, name);
            const info = await stat(path).catch(() => undefined);
            if (!info?.isFile()) return;
            if (isNote(name)) totals.#notes.set(path, info.mtimeMs);
            else
              totals.#items.set(path, { bytes: info.size, at: info.mtimeMs });
          }),
        );
      }),
    );
    return totals;
  }

  kept(path: string, bytes: number, at: number): void {
    this.#items.set(path, { bytes, at });
  }

  noted(path: string, at: number): void {
    this.#notes.set(path, at);
  }

  removed(path: string): void {
    this.#items.delete(path);
    this.#notes.delete(path);
  }

  moved(from: string, to: string): void {
    const item = this.#items.get(from);
    if (!item) return;
    this.#items.delete(from);
    this.#items.set(to, item);
  }

  /** Forgets everything in a folder that was removed whole. */
  removedUnder(folder: string): void {
    const inside = `${folder}${sep}`;
    for (const map of [this.#items, this.#notes])
      for (const path of map.keys())
        if (path.startsWith(inside)) map.delete(path);
  }

  /** Items and notes kept before `cutoff`, never `spared`. */
  olderThan(
    cutoff: number,
    spared: string,
  ): { readonly items: string[]; readonly notes: string[] } {
    return {
      items: [...this.#items]
        .filter(([path, item]) => path !== spared && item.at < cutoff)
        .map(([path]) => path),
      notes: [...this.#notes]
        .filter(([, at]) => at < cutoff)
        .map(([path]) => path),
    };
  }

  /**
   * The oldest items to remove so the rest fit in `limit` bytes, never
   * `spared`, oldest first.
   */
  oldestBeyond(limit: number, spared: string): string[] {
    let total = 0;
    for (const item of this.#items.values()) total += item.bytes;
    if (total <= limit) return [];
    const chosen: string[] = [];
    const oldestFirst = [...this.#items].sort((a, b) => a[1].at - b[1].at);
    for (const [path, item] of oldestFirst) {
      if (total <= limit) break;
      if (path === spared) continue;
      chosen.push(path);
      total -= item.bytes;
    }
    return chosen;
  }
}
