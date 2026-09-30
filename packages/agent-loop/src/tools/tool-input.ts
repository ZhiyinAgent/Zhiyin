/**
 * Reading a tool call's input: the arguments the model streamed, as the object
 * a tool is handed.
 *
 * A model often sends input that is almost JSON. Some of those slips have
 * exactly one reading, and are fixed here without asking anyone: nothing
 * about them can change a value. Everything else is left for a repair or for
 * the model itself, with the parser's own account of what was wrong. The one
 * exception is input that stops before its object closes: what is missing
 * cannot be recovered by anyone but the model that meant to send it.
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
        reason: "The input was cut off before it ended.",
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
  if (typeof parsed === "string") {
    const inner = unwrapped(parsed);
    if (inner) {
      parsed = inner;
      corrections.push("an object sent as a string");
    }
  }
  if (!isObject(parsed))
    return {
      ok: false,
      reason: "The input was not valid JSON: it must be one object.",
      problem: "it must be one object",
      cutOff: false,
    };
  return { ok: true, arguments: parsed, corrections };
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
