import type { ApiBreak } from "@zhiyin/contract";

/** The pattern as a regular expression, or nothing for one that is not valid. */
function compiled(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/** The known API changes a failed script's error matches, in the table's order. */
export function matchBreaks(
  breaks: readonly ApiBreak[],
  error: string,
): readonly ApiBreak[] {
  return breaks.filter((change) => compiled(change.pattern)?.test(error));
}
