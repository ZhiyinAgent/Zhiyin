/**
 * How a refused call's input departs from its tool's schema, in plain words.
 *
 * A tool's refusal says what it needs; it does not always say which field of
 * this call was wrong, and a model told only "give a path and the text" tends
 * to resend the same fields. The schema the model was offered settles it:
 * fields it does not define, required ones left out, values of the wrong
 * kind, and where in a list or object each one is. It describes; whether the
 * call runs is still the tool's decision.
 */

import type { ToolCallInspection } from "@zhiyin/contract";

/** Enough for the model to act on; the rest would only repeat the pattern. */
const maximumProblems = 6;
/** Deeper than any tool's input goes. */
const maximumDepth = 4;

type Schema = Readonly<Record<string, unknown>>;

const kindWords: Readonly<Record<string, string>> = {
  array: "a list",
  object: "an object",
  string: "text",
  integer: "a whole number",
  number: "a number",
  boolean: "true or false",
  null: "null",
};

/** A correctable refusal, with how the input departs from the schema added. */
export function withSchemaProblems(
  inspection: ToolCallInspection,
  args: unknown,
  schema: unknown,
): ToolCallInspection {
  if (inspection.ok || !inspection.correctable) return inspection;
  const problems = schemaProblems(args, schema);
  if (!problems.length) return inspection;
  return {
    ...inspection,
    reason: `${inspection.reason} The input does not match the tool's schema: ${problems.join("; ")}.`,
  };
}

/**
 * One way the input departs from the schema, and where: no place when a key
 * on the way holds a dot or a bracket, which a path cannot name exactly.
 */
type Problem = { readonly path: string | undefined; readonly text: string };

export function schemaProblems(args: unknown, schema: unknown): string[] {
  const problems: Problem[] = [];
  check(args, schema, "", problems, 0, "");
  return problems.slice(0, maximumProblems).map((problem) => problem.text);
}

/**
 * Where the input departs from the schema, every place, as a repair names the
 * inputs it may change: `path`, `edits[0].replacements[1].find`.
 */
export function schemaFaults(args: unknown, schema: unknown): string[] {
  const problems: Problem[] = [];
  check(args, schema, "", problems, 0, "");
  return [
    ...new Set(
      problems.flatMap((problem) =>
        problem.path === undefined ? [] : [problem.path],
      ),
    ),
  ];
}

/** A key a path can hold as one step. */
const plainKey = /^[^.[\]]+$/;

function check(
  value: unknown,
  schema: unknown,
  at: string,
  problems: Problem[],
  depth: number,
  place: string | undefined,
): void {
  if (!isRecord(schema) || depth > maximumDepth) return;
  const name = `“${at}”`;
  const kinds = [schema["type"]].flat().filter((kind) => kind !== undefined);
  if (kinds.length && !kinds.some((kind) => isKind(value, kind))) {
    if (at)
      problems.push({
        path: place,
        text: `${name} must be ${kinds.map((kind) => kindWords[String(kind)] ?? String(kind)).join(" or ")}`,
      });
    return;
  }
  const choices = schema["enum"];
  if (Array.isArray(choices) && !choices.includes(value)) {
    problems.push({
      path: place,
      text: `${name} must be one of: ${choices.join(", ")}`,
    });
    return;
  }
  if (typeof value === "number") {
    const { minimum, maximum } = schema;
    if (typeof minimum === "number" && value < minimum)
      problems.push({
        path: place,
        text: `${name} must be at least ${minimum}`,
      });
    if (typeof maximum === "number" && value > maximum)
      problems.push({
        path: place,
        text: `${name} must be at most ${maximum}`,
      });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      check(
        item,
        schema["items"],
        `${at}[${index}]`,
        problems,
        depth + 1,
        place === undefined ? undefined : `${place}[${index}]`,
      ),
    );
    return;
  }
  if (!isRecord(value)) return;
  const properties = isRecord(schema["properties"]) ? schema["properties"] : {};
  const field = (key: string) => (at ? `${at}.${key}` : key);
  const placeOf = (key: string) =>
    place === undefined || !plainKey.test(key)
      ? undefined
      : place
        ? `${place}.${key}`
        : key;
  if (schema["additionalProperties"] === false)
    for (const key of Object.keys(value))
      if (!(key in properties))
        problems.push({
          path: placeOf(key),
          text: `“${field(key)}” is not one of its fields`,
        });
  const required = schema["required"];
  if (Array.isArray(required))
    for (const key of required)
      if (typeof key === "string" && !(key in value))
        problems.push({
          path: placeOf(key),
          text: `“${field(key)}” is missing`,
        });
  for (const [key, item] of Object.entries(value))
    if (key in properties)
      check(
        item,
        properties[key],
        field(key),
        problems,
        depth + 1,
        placeOf(key),
      );
}

function isKind(value: unknown, kind: unknown): boolean {
  switch (kind) {
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "null":
      return value === null;
    default:
      return typeof value === kind;
  }
}

function isRecord(value: unknown): value is Schema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
