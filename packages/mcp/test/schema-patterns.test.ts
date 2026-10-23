/**
 * A connector writes the schemas its calls are checked against, and a
 * `pattern` there is a regular expression the main process would run. One
 * written to backtrack would hold the whole app, so patterns are left to the
 * server; every other rule is still checked.
 */

import { describe, expect, it } from "vitest";
import { inputMismatch } from "../src/input-validation.js";

/** Takes exponential time on a backtracking engine against `slowText`. */
const backtracking = "^(a+)+$";
const slowText = `${"a".repeat(27)}!`;

/** A schema holding that expression. */
const slow = { type: "string", pattern: backtracking };

function timed<T>(run: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}

describe("a call's arguments", () => {
  it("are checked without the patterns the server wrote, which could hold the app", () => {
    const tool = {
      name: "label",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", pattern: backtracking },
          count: { type: "number" },
        },
      },
    };

    const checked = timed(() => inputMismatch(tool, { name: slowText }));

    expect(checked.value).toBeUndefined();
    expect(checked.ms).toBeLessThan(1_000);
    expect(inputMismatch(tool, { count: "three" })).toBe(
      "The arguments do not match what label expects: count must be number.",
    );
  });

  it("are checked without patterns that name properties", () => {
    const tool = {
      name: "tally",
      inputSchema: {
        type: "object",
        patternProperties: { [backtracking]: { type: "number" } },
        additionalProperties: false,
      },
    };

    const checked = timed(() => inputMismatch(tool, { [slowText]: 1 }));

    expect(checked.value).toBeUndefined();
    expect(checked.ms).toBeLessThan(1_000);
  });

  it.each([
    [
      "an allOf member",
      {
        type: "object",
        allOf: [{ patternProperties: { "^x-": { type: "string" } } }],
        unevaluatedProperties: false,
      },
    ],
    [
      "a definition it refers to",
      {
        type: "object",
        $defs: {
          extensions: { patternProperties: { "^x-": { type: "string" } } },
        },
        $ref: "#/$defs/extensions",
        properties: { name: { type: "string" } },
        unevaluatedProperties: false,
      },
    ],
  ])(
    "are not refused for a property a pattern in %s accepts",
    (_, inputSchema) => {
      const tool = { name: "headers", inputSchema };

      expect(inputMismatch(tool, { "x-trace": "abc" })).toBeUndefined();
    },
  );

  it.each([
    ["a default", { default: { evil: slow } }, "#/default/evil"],
    ["a constant", { const: slow }, "#/const"],
    ["an allowed value", { enum: [slow] }, "#/enum/0"],
    ["an example", { examples: [slow] }, "#/examples/0"],
    [
      "a default, written in escapes",
      { default: { evil: slow } },
      "#/de%66ault/evil",
    ],
    [
      "a default, named by the schema's own address",
      { $id: "https://tool.example/schema", default: { evil: slow } },
      "https://tool.example/schema#/default/evil",
    ],
    [
      "a default that names properties by pattern",
      {
        default: {
          evil: {
            type: "object",
            patternProperties: { [backtracking]: { type: "number" } },
          },
        },
      },
      "#/default/evil",
    ],
    [
      "an example named by an address of its own",
      { examples: { $id: "urn:evil", ...slow } },
      "urn:evil",
    ],
    [
      "a default named by an address of its own",
      { default: { $id: "urn:evil", ...slow } },
      "urn:evil",
    ],
    [
      "a constant named by an address of its own",
      { const: { $id: "urn:evil", ...slow } },
      "urn:evil",
    ],
    [
      "an allowed value named by an address of its own",
      { enum: [{ $id: "urn:evil", ...slow }] },
      "urn:evil",
    ],
    [
      "an example named by an anchor",
      { examples: { $anchor: "evil", ...slow } },
      "#evil",
    ],
  ])(
    "are checked without a pattern hidden in %s that a reference points to",
    (_case, holding, reference) => {
      const tool = {
        name: "label",
        inputSchema: {
          type: "object",
          ...holding,
          properties: { name: { $ref: reference } },
        },
      };

      const checked = timed(() =>
        inputMismatch(tool, { name: slowText, [slowText]: 1 }),
      );

      expect(checked.ms).toBeLessThan(1_000);
    },
  );

  it("keep the rules a reference points to in a property named like a value keyword", () => {
    const tool = {
      name: "find",
      inputSchema: {
        type: "object",
        properties: {
          default: { type: "string" },
          name: { $ref: "#/properties/default" },
        },
      },
    };

    expect(inputMismatch(tool, { name: 3 })).toBe(
      "The arguments do not match what find expects: name must be string.",
    );
  });

  it("keep the rules of properties named like the keywords left out", () => {
    const tool = {
      name: "find",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          patternProperties: { type: "string" },
        },
      },
    };

    expect(inputMismatch(tool, { pattern: 3 })).toBe(
      "The arguments do not match what find expects: pattern must be string.",
    );
    expect(inputMismatch(tool, { patternProperties: 3 })).toBe(
      "The arguments do not match what find expects: patternProperties must be string.",
    );
  });
});
