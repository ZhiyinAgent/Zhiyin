/**
 * The CAD tools' definitions as a model is sent them stay short: each says
 * what the tool does, its inputs and its limits, and points to the studio's
 * pages for the rest, every one of which the catalog can open.
 */

import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadKnowledge, cadTools, type CadPython } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/** A definition as it is sent: its name, description and input schema. */
const sent = (tool: (typeof cadTools)[number]) =>
  JSON.stringify({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  });

describe("the CAD tools' definitions", () => {
  it.each(cadTools.map((tool) => [tool.name, tool] as const))(
    "%s is under 6,500 characters as sent",
    (_name, tool) => {
      expect(sent(tool).length).toBeLessThan(6500);
    },
  );

  it("say what every input is", () => {
    const undescribed: string[] = [];
    const walk = (schema: Record<string, unknown>, at: string) => {
      for (const [key, value] of Object.entries(
        (schema["properties"] as
          Record<string, Record<string, unknown>> | undefined) ?? {},
      )) {
        if (typeof value["description"] !== "string" || !value["description"])
          undescribed.push(`${at}.${key}`);
        walk(value, `${at}.${key}`);
        const items = value["items"] as Record<string, unknown> | undefined;
        if (items) walk(items, `${at}.${key}[]`);
      }
    };
    for (const tool of cadTools)
      walk(tool.inputSchema as Record<string, unknown>, tool.name);

    expect(undescribed).toEqual([]);
  });

  it("give every number its unit, and say which three numbers are a direction", () => {
    const unitless: string[] = [];
    const walk = (schema: Record<string, unknown>, at: string) => {
      for (const [key, value] of Object.entries(
        (schema["properties"] as
          Record<string, Record<string, unknown>> | undefined) ?? {},
      )) {
        const items = value["items"] as Record<string, unknown> | undefined;
        const numeric =
          value["type"] === "number" || items?.["type"] === "number";
        if (
          numeric &&
          !/\bmm\b|degrees|direction|×/.test(String(value["description"]))
        )
          unitless.push(`${at}.${key}`);
        walk(value, `${at}.${key}`);
        if (items) walk(items, `${at}.${key}[]`);
      }
    };
    for (const tool of cadTools)
      walk(tool.inputSchema as Record<string, unknown>, tool.name);

    expect(unitless).toEqual([]);
  });

  it("give every input one type, and every point three numbers", () => {
    // An input that may be either of two kinds, as a name or a point, arrived
    // cut off at that value from providers that read a written-out call back
    // by its declared type.
    const untyped: string[] = [];
    const points: string[] = [];
    const walk = (schema: unknown, at: string) => {
      const node = schema as Record<string, unknown>;
      if (typeof node["type"] !== "string" || node["anyOf"] || node["oneOf"])
        untyped.push(at);
      const items = node["items"] as Record<string, unknown> | undefined;
      if (
        items?.["type"] === "number" &&
        (node["minItems"] !== 3 || node["maxItems"] !== 3)
      )
        points.push(at);
      for (const [key, value] of Object.entries(
        (node["properties"] as Record<string, unknown> | undefined) ?? {},
      ))
        walk(value, `${at}.${key}`);
      if (items) walk(items, `${at}[]`);
    };
    for (const tool of cadTools) walk(tool.inputSchema, tool.name);

    expect(untyped).toEqual([]);
    expect(points).toEqual([]);
  });

  it("point only to pages the studio's knowledge opens", async () => {
    const python: CadPython = {
      state: async () => "unavailable",
      run: async () => {
        throw new Error("No Python runs to list or open a written page.");
      },
    };
    const data = await folders.make("zhiyin-cad-budget-");
    const knowledge = cadKnowledge(python, {
      harness: join(data, "run.py"),
      directory: data,
    });
    const named = new Set(
      cadTools.flatMap(
        (tool) => sent(tool).match(/doc:3d-rendering\/[\w-]+/g) ?? [],
      ),
    );

    expect(named.size).toBeGreaterThan(0);
    for (const id of named) expect(await knowledge.page(id)).toBeDefined();
  });
});
