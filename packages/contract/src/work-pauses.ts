/**
 * When a long task stops to ask whether to go on: once one stretch of its
 * work reaches this many rounds of actions, minutes, or spending in dollars
 * or in yuan. The person sets them in Settings; a task that reaches any of
 * them asks before its next action.
 */
export type WorkPauses = {
  readonly rounds: number;
  readonly minutes: number;
  /** What providers charged, or price lists estimate, in US dollars. */
  readonly dollars: number;
  /** What a mainland China platform's price list estimates, in yuan. */
  readonly yuan: number;
};

export const defaultWorkPauses: WorkPauses = {
  rounds: 50,
  minutes: 30,
  dollars: 10,
  yuan: 70,
};

/** The least and the most each may be set to, in whole numbers. */
export const workPauseRange: {
  readonly [Key in keyof WorkPauses]: readonly [number, number];
} = {
  rounds: [5, 1_000],
  minutes: [5, 1_440],
  dollars: [1, 1_000],
  yuan: [5, 7_000],
};

const pauseNames = Object.keys(workPauseRange) as (keyof WorkPauses)[];

/** Every limit present, a whole number within its range, and nothing else. */
export function isWorkPauses(value: unknown): value is WorkPauses {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === pauseNames.length &&
    pauseNames.every((name) => {
      const entry = record[name];
      const [least, most] = workPauseRange[name];
      return (
        typeof entry === "number" &&
        Number.isInteger(entry) &&
        entry >= least &&
        entry <= most
      );
    })
  );
}
