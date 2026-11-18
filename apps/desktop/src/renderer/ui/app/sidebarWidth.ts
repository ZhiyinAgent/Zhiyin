/** The narrowest and widest the person may make the navigation column, in pixels. */
export const sidebarWidthRange = { min: 220, max: 440 } as const;

const key = "zhiyin.sidebar-width";

/** A width brought inside the range, whole pixels. */
export function clampSidebarWidth(width: number): number {
  return Math.round(
    Math.min(sidebarWidthRange.max, Math.max(sidebarWidthRange.min, width)),
  );
}

/** The width the person left the column at, or nothing when there is none. */
export function savedSidebarWidth(): number | undefined {
  try {
    const saved = Number(window.localStorage.getItem(key));
    return Number.isFinite(saved) && saved > 0
      ? clampSidebarWidth(saved)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the width for the next start; a window that cannot keep it forgets it. */
export function saveSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(key, String(width));
  } catch {
    // Nothing is kept; the column opens at its default next time.
  }
}
