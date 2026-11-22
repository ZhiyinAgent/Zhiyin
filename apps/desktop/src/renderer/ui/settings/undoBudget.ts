import { useEffect, useState } from "react";
import type { UndoBudgetState } from "@zhiyin/contract";

/** A size in decimal gigabytes, to a tenth below 10: 0.6, 8.4, 50. */
export function gigabytesOf(bytes: number): number {
  const value = bytes / 1e9;
  return value < 10 ? Number(value.toFixed(1)) : Math.round(value);
}

/**
 * A size in decimal gigabytes, as the undo budget is set: "0.6 GB", "50 GB".
 * Written as the field beside it shows numbers, by the system's settings: a
 * person whose Windows writes "8,4" reads the same in both.
 */
export function gigabytes(bytes: number): string {
  return `${gigabytesOf(bytes).toLocaleString(navigator.language, { maximumFractionDigits: 1 })} GB`;
}

/**
 * The undo budget as the core holds it, read each time `read` is given, as
 * when Settings opens, and as each change the person saves leaves it.
 */
export function useUndoBudget(
  read: (() => Promise<UndoBudgetState | null>) | undefined,
  set: ((bytes: number) => Promise<UndoBudgetState>) | undefined,
): {
  readonly budget: UndoBudgetState | undefined;
  readonly save: ((bytes: number) => Promise<void>) | undefined;
} {
  const [budget, setBudget] = useState<UndoBudgetState | undefined>();
  useEffect(() => {
    if (!read) return;
    let live = true;
    read()
      .then((state) => {
        if (live) setBudget(state ?? undefined);
      })
      // A budget that cannot be read is not offered.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [read]);
  return {
    budget,
    save: set && (async (bytes) => setBudget(await set(bytes))),
  };
}
