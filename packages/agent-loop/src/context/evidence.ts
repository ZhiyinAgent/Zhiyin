import { textWithoutCredentials, withoutCredentials } from "@zhiyin/contract";

/**
 * A protocol answer often carries its real payload as a string of JSON inside
 * a field, so the interesting part arrives escaped. Decoding it here rather
 * than where it is drawn means the record itself is readable, and means a
 * credential buried inside that inner payload is redacted like any other.
 */
function decodeNested(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  if (typeof value === "string") {
    const start = value.trimStart()[0];
    if (start !== "{" && start !== "[") return value;
    try {
      return decodeNested(JSON.parse(value), depth + 1);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value))
    return value.map((entry) => decodeNested(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        decodeNested(entry, depth + 1),
      ]),
    );
  }
  return value;
}

/**
 * What a tool answered, kept as something a person can read.
 *
 * Laid out before it is shortened, not after. A record cut down to length is
 * no longer parseable, so anything that waited until it was drawn to indent it
 * would be left with a wall of text in exactly the case where a wall of text
 * is least usable — a long answer. Cutting an already-indented document leaves
 * both halves readable.
 */
export function evidenceText(value: unknown, maximum = 24_000): string {
  const serialized =
    typeof value === "string"
      ? value
      : (JSON.stringify(withoutCredentials(decodeNested(value)), null, 2) ??
        "");
  const text = textWithoutCredentials(serialized);
  if (text.length <= maximum) return text;
  const marker = "\n… evidence shortened; read the source for detail …\n";
  const edge = Math.floor((maximum - marker.length) / 2);
  return `${text.slice(0, edge)}${marker}${text.slice(-edge)}`;
}
