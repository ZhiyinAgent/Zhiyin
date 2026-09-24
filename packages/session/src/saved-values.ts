/** The plainest checks every saved record is built from. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

export function validSequence(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}
