/**
 * Where a call's input departs from its tool's schema, each place in plain
 * words: fields the schema does not define, required ones left out, values of
 * the wrong kind or out of bounds, and where in a list or object each one is.
 *
 * The keywords read are `type`, `enum`, `minimum`, `maximum`, `minLength`,
 * `maxLength`, `minItems`, `maxItems`, `items`, `properties`, `required` and
 * `additionalProperties: false`. Any other keyword is not checked, so an
 * input this finds nothing wrong with may still be refused by the tool.
 */

/** Enough for the model to act on; the rest would only repeat the pattern. */
const maximumProblems = 6;

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

/** One way the input departs from the schema. */
type Problem = {
  readonly text: string;
  /** The field the schema does not define, as the model wrote it. */
  readonly unknown?: string;
};

/**
 * The input as the tool declares it, once it holds to `schema`, or nothing.
 * The type is the tool's own statement of what its schema allows.
 */
export function schemaInput<T>(schema: unknown, args: unknown): T | undefined {
  return problemsOf(args, schema).length ? undefined : (args as T);
}

/** How the input departs from the schema, the first few, in words. */
export function schemaProblems(args: unknown, schema: unknown): string[] {
  return problemsOf(args, schema)
    .slice(0, maximumProblems)
    .map((problem) => problem.text);
}

/**
 * A refusal of a call on its input, as the model is told it: `reason`, the
 * refusing tool's own words, then each way the input departs from the schema
 * that the reason does not already say. An input that holds to the schema
 * adds nothing.
 */
export function withSchemaProblems(
  reason: string,
  args: unknown,
  schema: unknown,
): string {
  const problems = schemaProblems(args, schema).filter(
    (problem) => !reason.includes(problem),
  );
  return problems.length
    ? `${reason} The input does not match the tool's schema: ${problems.join("; ")}.`
    : reason;
}

/**
 * The fields of an input its schema says the tool does not take, each as
 * `loop` or `keys[0].speed`: a call that runs runs without them.
 */
export function unusedFields(args: unknown, schema: unknown): string[] {
  return problemsOf(args, schema).flatMap((problem) =>
    problem.unknown === undefined ? [] : [problem.unknown],
  );
}

function problemsOf(args: unknown, schema: unknown): Problem[] {
  const problems: Problem[] = [];
  check(args, schema, "", problems);
  return problems;
}

function check(
  value: unknown,
  schema: unknown,
  at: string,
  problems: Problem[],
): void {
  if (!isRecord(schema)) return;
  const name = at ? `“${at}”` : "The input";
  const kinds = [schema["type"]].flat().filter((kind) => kind !== undefined);
  if (kinds.length && !kinds.some((kind) => isKind(value, kind))) {
    problems.push({
      text: `${name} must be ${kinds.map((kind) => kindWords[String(kind)] ?? String(kind)).join(" or ")}`,
    });
    return;
  }
  const choices = schema["enum"];
  if (Array.isArray(choices) && !choices.includes(value)) {
    problems.push({ text: `${name} must be one of: ${choices.join(", ")}` });
    return;
  }
  if (typeof value === "number") {
    const { minimum, maximum } = schema;
    if (typeof minimum === "number" && value < minimum)
      problems.push({ text: `${name} must be at least ${minimum}` });
    if (typeof maximum === "number" && value > maximum)
      problems.push({ text: `${name} must be at most ${maximum}` });
    return;
  }
  if (typeof value === "string") {
    const { minLength, maxLength } = schema;
    // Counted in characters, as a schema's bound is, not JavaScript units.
    const length = [...value].length;
    if (typeof minLength === "number" && length < minLength)
      problems.push({
        text: `${name} must be at least ${count(minLength, "character")}`,
      });
    if (typeof maxLength === "number" && length > maxLength)
      problems.push({
        text: `${name} must be at most ${count(maxLength, "character")}`,
      });
    return;
  }
  if (Array.isArray(value)) {
    const { minItems, maxItems } = schema;
    if (typeof minItems === "number" && value.length < minItems)
      problems.push({
        text: `${name} must hold at least ${count(minItems, "item")}`,
      });
    if (typeof maxItems === "number" && value.length > maxItems)
      problems.push({
        text: `${name} must hold at most ${count(maxItems, "item")}`,
      });
    value.forEach((item, index) =>
      check(item, schema["items"], `${at}[${index}]`, problems),
    );
    return;
  }
  if (!isRecord(value)) return;
  const properties = isRecord(schema["properties"]) ? schema["properties"] : {};
  const field = (key: string) => (at ? `${at}.${key}` : key);
  if (schema["additionalProperties"] === false)
    for (const key of Object.keys(value))
      if (!Object.hasOwn(properties, key))
        problems.push({
          text: `“${field(key)}” is not one of its fields`,
          unknown: field(key),
        });
  const required = schema["required"];
  if (Array.isArray(required))
    for (const key of required)
      if (typeof key === "string" && !Object.hasOwn(value, key))
        problems.push({ text: `“${field(key)}” is missing` });
  for (const [key, item] of Object.entries(value))
    if (Object.hasOwn(properties, key))
      check(item, properties[key], field(key), problems);
}

function count(amount: number, thing: string): string {
  return `${amount} ${thing}${amount === 1 ? "" : "s"}`;
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
      return typeof value === "number" && Number.isFinite(value);
    case "null":
      return value === null;
    default:
      return typeof value === kind;
  }
}

function isRecord(value: unknown): value is Schema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
