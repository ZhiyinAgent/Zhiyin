/**
 * A call's input checked against the schema its tool offers the model, so the
 * schema is the one statement of the input's types, names and bounds: for the
 * tool that takes the input and words its refusal, and for the loop that
 * finds the fields a tool does not take.
 */

export {
  schemaInput,
  schemaProblems,
  unusedFields,
  withSchemaProblems,
} from "./schema-check.js";
