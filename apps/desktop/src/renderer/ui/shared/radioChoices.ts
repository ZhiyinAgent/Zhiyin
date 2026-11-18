/**
 * Which choice Tab reaches: the chosen one, or the first that can be chosen
 * when none of those listed is.
 */
export function tabStopOf<T>(
  choices: readonly T[],
  chosen: (choice: T) => boolean,
  available: (choice: T) => boolean = () => true,
): T | undefined {
  return choices.find(chosen) ?? choices.find(available);
}
