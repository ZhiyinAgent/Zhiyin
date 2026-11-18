/**
 * The JSON Schema checks Zhiyin runs on a connector's schemas: its arguments
 * before a call, and the SDK's check of an answer against the output the tool
 * declares.
 *
 * A server writes these schemas, and a `pattern` is a regular expression run
 * by a backtracking engine on the main process, where one written to backtrack
 * would hold the whole app for as long as the server likes. So patterns are
 * left out of what is checked here: every other rule holds, and the server
 * still checks its own patterns when it is called.
 */

import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/client";

/** Keywords whose value maps names to schemas, not a schema of its own. */
const namedSchemas = new Set([
  "properties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

/**
 * A copy of `schema` without its regular expressions: `pattern` goes, and so
 * does `patternProperties`, with `additionalProperties` beside it, since
 * without it the properties it accepted would be judged as unlisted. Where
 * the schema has `patternProperties` anywhere, `unevaluatedProperties` goes
 * everywhere too: it judges what any part of the schema accepted, through
 * `allOf` or a reference as much as beside it. A `default` or an `examples`
 * checks nothing and goes too, with whatever it holds: an address or anchor
 * inside one would let a reference reach a pattern there.
 */
function withoutPatterns(schema: unknown): unknown {
  return stripped(schema, holdsPatternProperties(schema), schema);
}

function holdsPatternProperties(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsPatternProperties);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, member]) =>
      key === "patternProperties" || holdsPatternProperties(member),
  );
}

/** Keywords that hold values, not schemas. */
const valueKeywords = new Set(["enum", "const", "default", "examples"]);

/**
 * Whether a reference points inside one of those values. The validator would
 * read what it finds there as a schema, patterns included, so such a
 * reference is left out with them: what it checked, the server checks. The
 * path is followed through `root`, so a property that is only named like one
 * of those keywords keeps its rules; a path that cannot be followed there is
 * judged by its names alone.
 */
function pointsIntoValue(reference: string, root: unknown): boolean {
  const fragment = reference.slice(reference.indexOf("#") + 1);
  if (!reference.includes("#") || !fragment.startsWith("/")) return false;
  let segments: string[];
  try {
    segments = fragment
      .slice(1)
      .split("/")
      .map((segment) =>
        decodeURIComponent(segment).replaceAll("~1", "/").replaceAll("~0", "~"),
      );
  } catch {
    return true;
  }
  let node = root;
  // Whether `node` maps names to schemas, where a name is never a keyword.
  let names = false;
  for (const segment of segments) {
    if (Array.isArray(node)) {
      node = node[Number(segment)];
      names = false;
      continue;
    }
    if (!node || typeof node !== "object")
      return segments.some((each) => valueKeywords.has(each));
    if (!names && valueKeywords.has(segment)) return true;
    node = (node as Record<string, unknown>)[segment];
    names = !names && namedSchemas.has(segment);
  }
  return false;
}

function stripped(
  schema: unknown,
  anyPatternProperties: boolean,
  root: unknown,
): unknown {
  const strip = (value: unknown) => stripped(value, anyPatternProperties, root);
  if (Array.isArray(schema)) return schema.map(strip);
  if (!schema || typeof schema !== "object") return schema;
  const source = schema as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "pattern" && typeof value === "string") continue;
    if (key === "patternProperties") continue;
    if (key === "additionalProperties" && "patternProperties" in source)
      continue;
    if (key === "unevaluatedProperties" && anyPatternProperties) continue;
    if (key === "default" || key === "examples") continue;
    if (
      key === "$ref" &&
      typeof value === "string" &&
      pointsIntoValue(value, root)
    )
      continue;
    copy[key] =
      namedSchemas.has(key) && value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([name, member]) => [
              name,
              strip(member),
            ]),
          )
        : // A constant and the allowed values are compared, as written.
          valueKeywords.has(key)
          ? value
          : strip(value);
  }
  return copy;
}

/** The SDK's own validator, given each schema without its patterns. */
export class PatternFreeValidator implements jsonSchemaValidator {
  readonly #inner = new AjvJsonSchemaValidator();

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    return this.#inner.getValidator<T>(
      withoutPatterns(schema) as JsonSchemaType,
    );
  }
}
