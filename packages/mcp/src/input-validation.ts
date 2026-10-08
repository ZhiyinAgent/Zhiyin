import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type { McpConnectionTool } from "./connection-types.js";

type Check = (input: unknown) => string | undefined;

const validator = new AjvJsonSchemaValidator();
/** Compiled once per schema; `null` for a schema that cannot be compiled. */
const compiled = new WeakMap<object, Check | null>();

function compile(schema: Readonly<Record<string, unknown>>): Check | null {
  try {
    const validate = validator.getValidator(schema);
    return (input) => {
      const outcome = validate(input);
      return outcome.valid ? undefined : outcome.errorMessage;
    };
  } catch {
    // A dialect the validator does not know, or a schema that is not valid
    // JSON Schema, says nothing reliable about a call. The server decides.
    return null;
  }
}

/**
 * Why a call's arguments do not fit the input schema the tool published, or
 * nothing when they fit or the schema cannot be read.
 */
export function inputMismatch(
  tool: McpConnectionTool,
  args: Readonly<Record<string, unknown>>,
): string | undefined {
  const schema = tool.inputSchema;
  if (!schema) return undefined;
  let check = compiled.get(schema);
  if (check === undefined) {
    check = compile(schema);
    compiled.set(schema, check);
  }
  const problem = check?.(args);
  if (problem === undefined) return undefined;
  // Each error starts with where in the input it is, under the name `data`.
  const readable = problem
    .replace(/(^|, )data\//g, "$1")
    .replace(/(^|, )data /g, "$1the input ");
  return `The arguments do not match what ${tool.name} expects: ${readable}.`;
}
