/**
 * A call's input, read as an object, corrected where it misses its tool's
 * schema in a way that has one reading: the call is run as corrected, and
 * the model is told each correction in plain words. Whatever could mean more
 * than one thing is left for the tool to refuse.
 *
 * In order: a direct call sent in the bridge's `{name, arguments}` shape for
 * this same tool is unwrapped; a field sent as the JSON text of the list or
 * object its schema asks for is read as that value; a field sent under a
 * name the schema says it reads as another is read as that one; and a purpose sent inside an item, or a second `purposes` beside
 * it, where the schema refuses it, is lifted to the top or left out
 * (ADR 0014). None of these changes a value the model sent (ADR 0009): a
 * number, list or text past its schema's limit is left for the tool to
 * refuse, naming the limit.
 */

import { readAsKey, type ToolSpec } from "@zhiyin/contract";
import { readEncodedValues } from "./tool-input.js";

type Fields = Record<string, unknown>;

type Corrected = {
  readonly arguments: Fields;
  readonly corrections: readonly string[];
};

export function correctedInput(
  args: Fields,
  tool: Pick<ToolSpec, "name" | "inputSchema"> | undefined,
): Corrected {
  if (!tool) return { arguments: args, corrections: [] };
  const schema = tool.inputSchema;
  const steps = [
    (input: Fields) => unwrappedCall(input, tool.name, schema),
    (input: Fields) => readEncodedValues(input, schema),
    (input: Fields) => renamedFields(input, schema),
    (input: Fields) => liftedPurpose(input, schema),
  ];
  let current = args;
  const corrections: string[] = [];
  for (const step of steps) {
    const next = step(current);
    current = next.arguments;
    corrections.push(...next.corrections);
  }
  return { arguments: current, corrections };
}

/**
 * Fields sent under a name the schema declares it reads as another: the
 * name a sibling tool, or another harness's tool of the same name, gives
 * the same input.
 */
function renamedFields(args: Fields, schema: unknown): Corrected {
  const properties = propertiesOf(schema);
  const declared = isRecord(schema) ? schema[readAsKey] : undefined;
  const read = { ...args };
  const corrections: string[] = [];
  for (const [given, field] of Object.entries(
    isRecord(declared) ? declared : {},
  )) {
    if (typeof field !== "string") continue;
    if (!Object.hasOwn(read, given) || Object.hasOwn(read, field)) continue;
    if (properties && Object.hasOwn(properties, given)) continue;
    read[field] = read[given];
    delete read[given];
    corrections.push(`${given} read as ${field}`);
  }
  return corrections.length
    ? { arguments: read, corrections }
    : { arguments: args, corrections };
}

/**
 * A direct call whose input is the bridge's `{name, arguments}` naming this
 * same tool, by its whole name or the part after its connection's prefix.
 * A tool whose own schema takes `name` or `arguments` is never unwrapped.
 */
function unwrappedCall(args: Fields, tool: string, schema: unknown): Corrected {
  const unchanged = { arguments: args, corrections: [] };
  const properties = propertiesOf(schema) ?? {};
  if (
    Object.hasOwn(properties, "name") ||
    Object.hasOwn(properties, "arguments")
  )
    return unchanged;
  const { name, arguments: inner, purpose, ...rest } = args;
  if (Object.keys(rest).length || typeof name !== "string") return unchanged;
  if (name !== tool && !tool.endsWith(`__${name}`)) return unchanged;
  const value = typeof inner === "string" ? parsed(inner) : inner;
  if (!isRecord(value)) return unchanged;
  return {
    arguments:
      purpose !== undefined && !Object.hasOwn(value, "purpose")
        ? { ...value, purpose }
        : value,
    corrections: ["its input unwrapped from {name, arguments}"],
  };
}

/**
 * The call's purpose where it belongs, at the top of its input. One found in
 * a nested object whose schema takes no field it does not list, and does not
 * list one, is moved up when the call has none, and left out when it has; a
 * `purposes` such a schema does not take is read as the purpose, or left out
 * beside it. Where a schema takes any field, the tool is handed it as sent.
 */
function liftedPurpose(args: Fields, schema: unknown): Corrected {
  if (!isRecord(schema) || schema["type"] !== "object")
    return { arguments: args, corrections: [] };
  const properties = propertiesOf(schema) ?? {};
  const corrections: string[] = [];
  let read = args;
  const given = () => {
    const purpose = read["purpose"];
    return typeof purpose === "string" && purpose.trim().length > 0;
  };
  for (const [key, value] of Object.entries(args)) {
    if (!Object.hasOwn(properties, key)) continue;
    const found: { at: string; purpose: unknown }[] = [];
    const next = withoutNested(value, properties[key], key, found);
    if (next === value) continue;
    read = { ...read, [key]: next };
    for (const { at, purpose } of found) {
      if (!given() && typeof purpose === "string" && purpose.trim()) {
        read = { ...read, purpose };
        corrections.push(`purpose moved up from ${at}`);
      } else
        corrections.push(`purpose left out of ${at}, as the call has its own`);
    }
  }
  if (Object.hasOwn(read, "purposes") && takesNoOther(schema, "purposes")) {
    const { purposes, ...rest } = read;
    if (given()) {
      read = rest;
      corrections.push("purposes left out beside purpose");
    } else if (typeof purposes === "string" && purposes.trim()) {
      read = { ...rest, purpose: purposes };
      corrections.push("purposes read as purpose");
    }
  }
  return { arguments: read, corrections };
}

/**
 * `value` without the `purpose` of each object in it whose schema refuses
 * one; each taken is added to `found` with where it was. The same value when
 * none was.
 */
function withoutNested(
  value: unknown,
  schema: unknown,
  at: string,
  found: { at: string; purpose: unknown }[],
): unknown {
  if (!isRecord(schema)) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item, index) => {
      const next = withoutNested(
        item,
        schema["items"],
        `${at}[${index}]`,
        found,
      );
      if (next !== item) changed = true;
      return next;
    });
    return changed ? items : value;
  }
  if (!isRecord(value)) return value;
  const properties = propertiesOf(schema) ?? {};
  let read: Fields = value;
  if (Object.hasOwn(value, "purpose") && takesNoOther(schema, "purpose")) {
    const { purpose, ...rest } = value;
    found.push({ at, purpose });
    read = rest;
  }
  for (const [key, item] of Object.entries(read)) {
    if (!Object.hasOwn(properties, key)) continue;
    const next = withoutNested(item, properties[key], `${at}.${key}`, found);
    if (next !== item) read = { ...read, [key]: next };
  }
  return read;
}

/** Whether the schema refuses `field`: it takes no field it does not list. */
function takesNoOther(schema: unknown, field: string): boolean {
  return (
    isRecord(schema) &&
    schema["additionalProperties"] === false &&
    !Object.hasOwn(propertiesOf(schema) ?? {}, field)
  );
}

function propertiesOf(schema: unknown): Fields | undefined {
  const properties = isRecord(schema) ? schema["properties"] : undefined;
  return isRecord(properties) ? properties : undefined;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Fields {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
