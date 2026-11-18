/**
 * What a value read from JSON is: the harness's answer, a call's input, or a
 * record read back from disk, each checked before it is used.
 */

/** An object, not an array or nothing. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An object, or nothing for any other value. */
export const asObject = (
  value: unknown,
): Record<string, unknown> | undefined => (isRecord(value) ? value : undefined);

export const isText = (value: unknown): value is string =>
  typeof value === "string";

/** A number that is not infinite or NaN. */
export const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Three such numbers: a point or a direction. */
export const isPoint = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(isNumber);
