import { workPauseRange, type WorkPauses } from "@zhiyin/contract";

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
