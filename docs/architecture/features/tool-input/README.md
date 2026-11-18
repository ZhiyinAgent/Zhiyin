# Tool input

## Purpose

A call's input checked against the schema its tool offers the model, so the
schema is the one statement of the input's types, names and bounds. The tools
take their input through it, and the feature that refuses a call on its input
words the refusal with it: the tools for theirs, the connections for every
connector's and built-in connection's. The agent loop finds the fields a call
sent that its tool does not take through the same check; features may not
import each other, and the loop imports no feature's code.
It is a pure package (ADR 0002): it reads values and schemas and does nothing
else.

## Boundaries

- **Owns:** which values a schema allows, and how an input departs from it,
  in words.
- **Does not own:** what a tool checks that a schema cannot say, such as ids
  that must differ or one input that goes only with another (each tool);
  whether a refusal is one the model can correct (the refusing feature); a
  connector's own schemas, which may use any JSON Schema keyword (the
  connections, which check them fully and add these words to their own).
- **Talks to other packages only through:** the functions below. It imports
  nothing.

## Public interface

- `schemaInput<T>(schema, args)`: the input as the tool declares it, once it
  holds to the schema, or nothing.
- `schemaProblems(args, schema)`: the first few ways the input departs from
  the schema, each in words, as "“edits[1].path” is missing".
- `unusedFields(args, schema)`: the fields of an input the schema says the
  tool does not take.
- `withSchemaProblems(reason, args, schema)`: a refusal of a call on its
  input as the model is told it: the refusing tool's words, then each way the
  input departs from the schema that they do not already say.

## Invariants

- The keywords read are `type`, `enum`, `minimum`, `maximum`, `minLength`,
  `maxLength`, `minItems`, `maxItems`, `items`, `properties`, `required` and
  `additionalProperties: false`, at any depth. Another keyword is not checked.
- An input holds to the schema exactly when no problem is found in it.
- A text's length is counted in characters, not JavaScript units.
- A number is finite; a whole number has no fraction.
- A field is defined, or present, only as the object's own: a name every
  object inherits, such as `constructor`, is neither.
- At most six problems are worded.
- A refusal worded with the schema's problems repeats none its own words
  already say, and adds nothing to an input that holds to the schema.
- It imports no Node module and no npm package. Lint enforces it.
