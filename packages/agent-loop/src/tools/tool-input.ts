/**
 * Reading a tool call's input: the arguments the model streamed, as the object
 * a tool is handed.
 *
 * A model often sends input that is almost JSON. Some of those slips have
 * exactly one reading, and are fixed here without asking anyone: nothing
 * about them can change a value. Everything else goes back to the model
 * itself, with the parser's own account of what was wrong: no repair writes
 * unreadable input out again (ADR 0010).
 */

export type ToolInput =
  | {
      readonly ok: true;
      readonly arguments: Record<string, unknown>;
      /** What was fixed on the way, in plain words; empty when nothing was. */
      readonly corrections: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /** What was wrong, in the parser's words. */
      readonly problem: string;
      /** The input ends before its object does: nothing can repair it. */
      readonly cutOff: boolean;
    };

/** One fix that cannot change any value, and how it is described. */
type Fix = {
  readonly correction: string;
  readonly apply: (text: string) => string;
};

const fixes: readonly Fix[] = [
  {
    correction: "a code fence",
    apply: (text) =>
      /^```[\w-]*\s*\n([\s\S]*)\n\s*```$/.exec(text.trim())?.[1] ?? text,
  },
  { correction: "unescaped control characters", apply: escapeControls },
  { correction: "a trailing comma", apply: withoutTrailingCommas },
];

export function readToolInput(raw: string): ToolInput {
  if (!raw.trim())
    return { ok: true, arguments: {}, corrections: ["empty input"] };
  // Valid input needs none of the fixes, and each rebuilds the whole text.
  const direct = parsedAsItStands(raw);
  if (direct !== unreadable) return withArguments(direct, []);
  let text = raw;
  const corrections: string[] = [];
  for (const fix of fixes) {
    const fixed = fix.apply(text);
    if (fixed === text) continue;
    text = fixed;
    corrections.push(fix.correction);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (endsEarly(text))
      return {
        ok: false,
        // Whether the answer ran out or the model left a bracket open, the
        // input reads the same; this says only what is so either way.
        reason:
          "The input stops before it is complete: a bracket or quote in it is never closed.",
        problem: "cut off",
        cutOff: true,
      };
    const problem =
      error instanceof Error ? error.message : "it could not be read";
    return {
      ok: false,
      reason: `The input was not valid JSON: ${problem}.`,
      problem,
      cutOff: false,
    };
  }
  return withArguments(parsed, corrections);
}

/** Marks input that does not parse as it stands. */
const unreadable = Symbol("unreadable");

function parsedAsItStands(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return unreadable;
  }
}

/** The parsed input as a tool's arguments, which must be one object. */
function withArguments(parsed: unknown, corrections: string[]): ToolInput {
  let value = parsed;
  if (typeof value === "string") {
    const inner = unwrapped(value);
    if (inner) {
      value = inner;
      corrections.push("an object sent as a string");
    }
  }
  if (!isObject(value))
    return {
      ok: false,
      reason: "The input was not valid JSON: it must be one object.",
      problem: "it must be one object",
      cutOff: false,
    };
  return { ok: true, arguments: value, corrections };
}

/**
 * A field whose schema accepts a list or an object but never text, sent as
 * the JSON text of one. Where it stands the text can never be valid, and it
 * has one reading: the value it spells.
 */
export function readEncodedValues(
  args: Record<string, unknown>,
  schema: unknown,
): {
  readonly arguments: Record<string, unknown>;
  readonly corrections: readonly string[];
} {
  const properties = isObject(schema) ? schema["properties"] : undefined;
  if (!isObject(properties)) return { arguments: args, corrections: [] };
  const read = { ...args };
  const corrections: string[] = [];
  for (const [name, value] of Object.entries(args)) {
    const property = properties[name];
    if (typeof value !== "string" || !isObject(property)) continue;
    const accepted = [property["type"]].flat();
    if (accepted.includes("string")) continue;
    let inner: unknown;
    try {
      inner = JSON.parse(value);
    } catch {
      continue;
    }
    if (
      (Array.isArray(inner) && accepted.includes("array")) ||
      (isObject(inner) && accepted.includes("object"))
    ) {
      read[name] = inner;
      corrections.push(`${name} sent as text`);
    }
  }
  return { arguments: corrections.length ? read : args, corrections };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapped(text: string): Record<string, unknown> | undefined {
  try {
    const inner: unknown = JSON.parse(text);
    return isObject(inner) ? inner : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walks `text` as JSON is read, calling `visit` for each character outside a
 * string with its position. Returns whether the walk ended inside a string.
 */
function walk(text: string, visit: (index: number) => void): boolean {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else visit(index);
  }
  return inString;
}

/**
 * JSON forbids a raw control character inside a string, so a newline or tab
 * found there can only have been meant as one: escaping it keeps the text.
 */
function escapeControls(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (inString && !escaped && code < 0x20) {
      out +=
        character === "\n"
          ? "\\n"
          : character === "\r"
            ? "\\r"
            : character === "\t"
              ? "\\t"
              : `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += character;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
  }
  return out;
}

/** A comma outside any string, followed only by space and a closing bracket. */
function withoutTrailingCommas(text: string): string {
  const doomed = new Set<number>();
  walk(text, (index) => {
    if (text[index] === "," && /^\s*[}\]]/.test(text.slice(index + 1)))
      doomed.add(index);
  });
  let out = "";
  for (let index = 0; index < text.length; index += 1)
    if (!doomed.has(index)) out += text[index];
  return out;
}

/** Whether the text stops inside a string or before its brackets close. */
function endsEarly(text: string): boolean {
  let depth = 0;
  const inString = walk(text, (index) => {
    const character = text[index];
    if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") depth -= 1;
  });
  return inString || depth > 0;
}
