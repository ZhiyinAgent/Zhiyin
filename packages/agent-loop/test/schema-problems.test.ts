import { describe, expect, it } from "vitest";
import { schemaFaults, schemaProblems } from "../src/tools/schema-problems.js";

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

  it("names every place at fault as a repair names inputs, and no place a path cannot spell exactly", () => {
    expect(
      schemaFaults(
        { edits: [{ path: 1, replacements: [] }], extra: true },
        edits,
      ),
    ).toEqual(["extra", "edits[0].path"]);
    // A key holding a dot or a bracket would be read back as another place.
    const dotted = {
      type: "object",
      properties: {
        meta: { type: "object" },
        "meta.body": { type: "string" },
        "list[0]": { type: "string" },
      },
      required: ["note.text"],
    };
    expect(
      schemaFaults(
        { meta: { body: "kept" }, "meta.body": 7, "list[0]": 1 },
        dotted,
      ),
    ).toEqual([]);
    expect(
      schemaProblems({ meta: { body: "kept" }, "meta.body": 7 }, dotted),
    ).toEqual(["“note.text” is missing", "“meta.body” must be text"]);
  });
});
