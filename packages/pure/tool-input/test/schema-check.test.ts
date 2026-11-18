import { describe, expect, it } from "vitest";
import {
  schemaInput,
  schemaProblems,
  unusedFields,
  withSchemaProblems,
} from "../src/index.js";

const edits = {
  type: "object",
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          replacements: { type: "array" },
        },
        required: ["path", "replacements"],
        additionalProperties: false,
      },
    },
    timeoutMs: { type: "integer", minimum: 1000, maximum: 60000 },
    mode: { type: "string", enum: ["append", "replace"] },
  },
  required: ["edits"],
  additionalProperties: false,
};

const quiz = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 64 },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: { type: "string", maxLength: 160 },
    },
  },
  required: ["title", "questions"],
  additionalProperties: false,
};

describe("how a call's input departs from its tool's schema", () => {
  it("names fields the tool does not take and required fields left out", () => {
    expect(schemaProblems({ path: "a.md", changes: [] }, edits)).toEqual([
      "“path” is not one of its fields",
      "“changes” is not one of its fields",
      "“edits” is missing",
    ]);
  });

  it("looks inside lists and objects, naming where the problem is", () => {
    expect(
      schemaProblems(
        { edits: [{ path: "a.md", replacements: [] }, { find: "x" }] },
        edits,
      ),
    ).toEqual([
      "“edits[1].find” is not one of its fields",
      "“edits[1].path” is missing",
      "“edits[1].replacements” is missing",
    ]);
  });

  it("names a value of the wrong kind, out of range, or not among the choices", () => {
    expect(
      schemaProblems({ edits: "[]", timeoutMs: 1.5, mode: "insert" }, edits),
    ).toEqual([
      "“edits” must be a list",
      "“timeoutMs” must be a whole number",
      "“mode” must be one of: append, replace",
    ]);
    expect(schemaProblems({ edits: [], timeoutMs: 120000 }, edits)).toEqual([
      "“timeoutMs” must be at most 60000",
    ]);
  });

  it("names text too short or too long, and a list with too few or too many items", () => {
    expect(
      schemaProblems({ title: "", questions: ["x".repeat(161)] }, quiz),
    ).toEqual([
      "“title” must be at least 1 character",
      "“questions[0]” must be at most 160 characters",
    ]);
    expect(
      schemaProblems({ title: "t".repeat(65), questions: [] }, quiz),
    ).toEqual([
      "“title” must be at most 64 characters",
      "“questions” must hold at least 1 item",
    ]);
    expect(
      schemaProblems({ title: "Quiz", questions: Array(13).fill("Q?") }, quiz),
    ).toEqual(["“questions” must hold at most 12 items"]);
  });

  it("counts a text's length in characters, though some take two JavaScript units", () => {
    expect(
      schemaProblems({ title: "😀".repeat(64), questions: ["Q?"] }, quiz),
    ).toEqual([]);
    expect(
      schemaProblems({ title: "𠀀".repeat(65), questions: ["Q?"] }, quiz),
    ).toEqual(["“title” must be at most 64 characters"]);
  });

  it("says an input that is not an object at all is wrong", () => {
    expect(schemaProblems("a.md", edits)).toEqual([
      "The input must be an object",
    ]);
  });

  it("names at most six problems", () => {
    const many = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`extra${index}`, index]),
    );
    expect(schemaProblems({ edits: [], ...many }, edits)).toHaveLength(6);
  });

  it("finds nothing in input that matches, and does not flag extra fields a schema allows", () => {
    expect(
      schemaProblems({ edits: [{ path: "a.md", replacements: [] }] }, edits),
    ).toEqual([]);
    expect(
      schemaProblems(
        { query: "x", extra: 1 },
        { type: "object", properties: { query: { type: "string" } } },
      ),
    ).toEqual([]);
  });

  it("names a field whose key holds a dot as the key is written", () => {
    const dotted = {
      type: "object",
      properties: {
        meta: { type: "object" },
        "meta.body": { type: "string" },
      },
      required: ["note.text"],
    };
    expect(
      schemaProblems({ meta: { body: "kept" }, "meta.body": 7 }, dotted),
    ).toEqual(["“note.text” is missing", "“meta.body” must be text"]);
  });

  it("names the fields the tool does not take, wherever they are", () => {
    expect(
      unusedFields(
        { edits: [{ path: "a.md", replacements: [], loop: 1 }], speed: 2 },
        edits,
      ),
    ).toEqual(["speed", "edits[0].loop"]);
  });

  it("takes a field a schema does not define only where the schema says so, not from an object's own names", () => {
    expect(
      schemaProblems({ edits: [], constructor: 1, toString: 2 }, edits),
    ).toEqual([
      "“constructor” is not one of its fields",
      "“toString” is not one of its fields",
    ]);
  });
});

describe("the input as the tool takes it", () => {
  it("is the input itself when it holds to the schema", () => {
    const input = { title: "Quiz", questions: ["Why?"] };
    expect(schemaInput(quiz, input)).toBe(input);
  });

  it("is nothing when anything departs from the schema, however deep", () => {
    expect(
      schemaInput(quiz, { title: "Quiz", questions: [7] }),
    ).toBeUndefined();
    expect(
      schemaInput(edits, { edits: [{ path: "a.md", replacements: "x" }] }),
    ).toBeUndefined();
    expect(
      schemaInput(
        { type: "object", properties: { at: { type: "number" } } },
        { at: Number.NaN },
      ),
    ).toBeUndefined();
  });
});

describe("a refusal of a call on its input", () => {
  it("says, after the tool's own words, how the input departs from the schema", () => {
    expect(
      withSchemaProblems(
        "Choose the edits to make.",
        { path: "a.md", changes: [] },
        edits,
      ),
    ).toBe(
      "Choose the edits to make. The input does not match the tool's schema: “path” is not one of its fields; “changes” is not one of its fields; “edits” is missing.",
    );
  });

  it("does not repeat what the tool's own words already say", () => {
    expect(
      withSchemaProblems(
        "The edits cannot be made as given: “edits” is missing.",
        { path: "a.md" },
        edits,
      ),
    ).toBe(
      "The edits cannot be made as given: “edits” is missing. The input does not match the tool's schema: “path” is not one of its fields.",
    );
    expect(
      withSchemaProblems(
        "The note cannot be opened: “edits” is missing.",
        {},
        edits,
      ),
    ).toBe("The note cannot be opened: “edits” is missing.");
  });

  it("is the tool's own words alone when the input holds to the schema", () => {
    expect(
      withSchemaProblems("a.md does not exist.", { edits: [] }, edits),
    ).toBe("a.md does not exist.");
  });
});
