/** Reading the fields a model wrote in a JSON answer. */

/** The answer as an object, or nothing when it is not one. */
export function recordFrom(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Text kept whole or not at all.
 *
 * Right where running long means the model misread the request rather than
 * answered it at length. A 300-character "two-to-six-word verb phrase" is not
 * a long title, it is a sentence, and the first 72 characters of a sentence
 * are worse copy than the specific fallback that stands beside it.
 */
export function boundedText(
  value: unknown,
  maximum: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  return text && text.length <= maximum ? text : undefined;
}
