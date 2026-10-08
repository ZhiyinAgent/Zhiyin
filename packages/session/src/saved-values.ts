/** The plainest checks every saved record is built from. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFolder(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.name === "string"
  );
}

export function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

export function validSequence(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validRetryDeadline(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.readyAt === "string" &&
      Number.isFinite(Date.parse(value.readyAt)) &&
      optionalText(value.count))
  );
}
