/**
 * A value as text with its keys in a stable order, so values that hold the
 * same compare equal however their keys were written. A key whose value is
 * undefined is left out, as JSON leaves it out.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, inner]) => inner !== undefined)
      .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Whether two values hold the same, whatever the order of their keys. */
export function sameValue(one: unknown, other: unknown): boolean {
  return canonical(one) === canonical(other);
}
