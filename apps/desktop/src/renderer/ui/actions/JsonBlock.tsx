import styles from "./actions.module.css";

/**
 * JSON as something to read rather than a wall to scroll past.
 *
 * Shared by what a tool was asked to do and what it answered, so both are laid
 * out the same way. Three things happen here and nothing else: the text is
 * indented, values that are themselves encoded JSON are decoded, and the parts
 * are coloured by what they are.
 */

/** Keys, strings, numbers, booleans and null; everything else is punctuation. */
const jsonToken =
  /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g;

/**
 * Whether a value is a structure worth colouring. A path, a sentence or a
 * search query is not: colouring the year inside "ZEvent 2026" as a number
 * breaks a phrase into pieces for no benefit.
 */
export function looksStructured(text: string): boolean {
  const start = text.trimStart()[0];
  return start === "{" || start === "[";
}

/**
 * A protocol answer often carries its real payload as a string of JSON inside
 * a field, so the interesting part arrives escaped — `"text":"{\"query\":…}"`.
 * That is a transport detail, not something a person should have to decode by
 * eye, so it is decoded here. The information is the same either way.
 */
function decodeNested(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  if (typeof value === "string") {
    if (!looksStructured(value)) return value;
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
 * Indented and decoded, or the original text when it is not JSON at all —
 * a shortened record no longer parses, and showing it as it is beats showing
 * nothing.
 */
export function formatJson(text: string): string {
  const trimmed = text.trim();
  if (!looksStructured(trimmed)) return text;
  try {
    return JSON.stringify(decodeNested(JSON.parse(trimmed)), null, 2) ?? text;
  } catch {
    return text;
  }
}

/**
 * Colours one run of JSON. Whether a run is worth colouring at all is the
 * caller's decision: a whole document plainly is, and a single line of one is
 * too even though it does not start with a brace.
 */
function tokenizeJson(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(jsonToken)) {
    const at = match.index;
    if (at > last) parts.push(text.slice(last, at));
    const [whole, key, string, number, literal] = match;
    const className = key
      ? styles["json-key"]
      : string
        ? styles["json-string"]
        : number
          ? styles["json-number"]
          : literal
            ? styles["json-literal"]
            : undefined;
    parts.push(
      className ? (
        <span className={className} key={`${at}-${whole.length}`}>
          {whole}
        </span>
      ) : (
        whole
      ),
    );
    last = at + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Each line is drawn separately, indented by its own depth, so that a value
 * too long for the panel wraps underneath itself instead of either running off
 * the side or falling back to the left margin. Indentation is what makes a
 * structure readable; colour only tells you what kind of thing you are looking
 * at once you can already see the shape.
 */
export function JsonBlock({
  text,
  className,
}: {
  text: string;
  className?: string | undefined;
}) {
  const formatted = formatJson(text);
  const structured = looksStructured(formatted);
  return (
    <div className={className ?? styles["json-block"]}>
      {formatted.split("\n").map((line, index) => {
        const indent = line.length - line.trimStart().length;
        return (
          <div
            className={styles["json-line"]}
            key={index}
            style={indent ? { paddingLeft: `${indent}ch` } : undefined}
          >
            {structured ? tokenizeJson(line.slice(indent)) : line.slice(indent)}
          </div>
        );
      })}
    </div>
  );
}
