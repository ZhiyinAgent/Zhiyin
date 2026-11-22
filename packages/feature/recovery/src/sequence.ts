/**
 * One order for everything recovery records in time, a copy taken for a run
 * and a file saved as it was first written alike, across sessions too: a
 * number that only grows, from the clock in microseconds.
 */

let last = 0;

export function nextSequence(): number {
  last = Math.max(last + 1, Date.now() * 1000);
  return last;
}

/** A number read back from disk, which later ones must follow. */
export function observeSequence(seen: number): void {
  last = Math.max(last, seen);
}
