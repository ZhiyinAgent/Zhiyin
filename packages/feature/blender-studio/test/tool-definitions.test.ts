/**
 * The 3D studio's tools as the model is offered them: each definition says
 * what the tool does, its inputs and its limits, within a budget, and points
 * to the catalog's pages for the rest; the tools load by toolkit (ADR 0017).
 */

import { describe, expect, it } from "vitest";
import { TOOLKIT_SIZE } from "@zhiyin/contract";
import { studioTools } from "../src/index.js";
import { toolkitDeclarations } from "../src/toolkits.js";
import { writtenPages } from "../src/written-pages.js";

/** Every description in a schema, however deep. */
function descriptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(descriptions);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) =>
      key === "description" && typeof inner === "string"
        ? [inner]
        : descriptions(inner),
    );
  return [];
}

/** What the model reads of a tool: its description and every description in its schema. */
const sent = (tool: (typeof studioTools)[number]) =>
  [tool.description, ...descriptions(tool.inputSchema)].join("");

type Schema = Record<string, unknown>;

/** Every input of every tool, however deep, by its path, as `blender_render.frame.margin`. */
function inputs(): [string, Schema][] {
  const found: [string, Schema][] = [];
  const walk = (schema: Schema | undefined, at: string) => {
    for (const [key, value] of Object.entries(
      (schema?.["properties"] as Record<string, Schema> | undefined) ?? {},
    )) {
      found.push([`${at}.${key}`, value]);
      walk(value, `${at}.${key}`);
      const items = value["items"] as Schema | undefined;
      walk(items, `${at}.${key}[]`);
      walk(items?.["items"] as Schema | undefined, `${at}.${key}[][]`);
    }
  };
  for (const tool of studioTools) walk(tool.inputSchema, tool.name);
  return found;
}

/** Whether an input is a number, or a list of numbers, of points or of lists of points. */
function numeric(schema: Schema): boolean {
  const items = schema["items"] as Schema | undefined;
  return (
    ["number", "integer"].includes(String(schema["type"])) ||
    (items !== undefined && numeric(items))
  );
}

/**
 * The words that say what a number counts in: a length, an angle, a time, a
 * picture's pixels, a mass, light, a share or a multiple of something named,
 * a ratio, a count, a direction, a seed, or a scale whose ends are named.
 */
const unit =
  /\bmm\b|\bm\b|metres?\b|centimetres?\b|degrees|seconds|milliseconds|\bframes?\b|pixels?\b|texels?\b|\bkg\b|watts|in stops|kelvin|f-stop|\bshares?\b|\bratio\b|\bmultiples?\b|×|\bcount\b|\b(how|this) many\b|\bdirection\b|\bseed\b|\ba scale\b|\b0 [a-z][^,;.]*, 1 [a-z]/i;

/**
 * The characters a tool's description and its inputs' descriptions may take:
 * 4,000, or what a tool with many inputs needs to say each in a clause, with
 * a little room. Detail past that belongs on the studio's pages.
 */
const budgets: Readonly<Record<string, number>> = {
  blender_shape_objects: 9_250,
  blender_animate: 7_200,
  blender_set_material: 6_600,
  blender_render: 5_000,
  blender_edit_objects: 4_700,
  blender_simulate: 4_600,
  blender_set_lighting: 4_400,
  blender_add_objects: 4_300,
};

describe("the 3D studio's tool definitions", () => {
  it("each stay within 4,000 characters as sent, or the budget of a tool with many inputs", () => {
    const over = studioTools
      .map((tool) => ({
        name: tool.name,
        length: sent(tool).length,
        budget: budgets[tool.name] ?? 4_000,
      }))
      .filter((tool) => tool.length > tool.budget);

    expect(over).toEqual([]);
  });

  it("say what every input is", () => {
    const undescribed = inputs()
      .filter(
        ([, schema]) =>
          typeof schema["description"] !== "string" || !schema["description"],
      )
      .map(([path]) => path);

    expect(undescribed).toEqual([]);
  });

  it("give every number its unit, or say it is a count or a direction", () => {
    const unitless = inputs()
      .filter(
        ([, schema]) =>
          numeric(schema) && !unit.test(String(schema["description"] ?? "")),
      )
      .map(([path]) => path);

    expect(unitless).toEqual([]);
  });

  it("point only to pages the studio has", () => {
    const pages = new Set(writtenPages.map((page) => page.id));
    const named = studioTools.flatMap((tool) =>
      [...sent(tool).matchAll(/doc:3d-rendering\/[\w-]+/g)].map(
        (found) => found[0],
      ),
    );

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((id) => !pages.has(id))).toEqual([]);
  });
});

describe("the 3D studio's toolkits", () => {
  const byToolkit = (id: string | undefined) =>
    studioTools
      .filter((tool) => tool.toolkit === id)
      .map((tool) => tool.name)
      .sort();

  it("leave the tools every 3D work uses untagged, as core", () => {
    expect(byToolkit(undefined)).toEqual([
      "blender_api",
      "blender_describe_scene",
      "blender_look",
      "blender_open_scene",
      "blender_render",
      "blender_run_script",
    ]);
  });

  it("put modelling, materials, camera and lighting, motion, scattering, decals, unwrapping, baking, measuring, rigging, simulation and export each in a toolkit of their own", () => {
    expect({
      modelling: byToolkit("modelling"),
      surfacing: byToolkit("surfacing"),
      "light-and-camera": byToolkit("light-and-camera"),
      motion: byToolkit("motion"),
      scatter: byToolkit("scatter"),
      decals: byToolkit("decals"),
      unwrap: byToolkit("unwrap"),
      bake: byToolkit("bake"),
      measure: byToolkit("measure"),
      rig: byToolkit("rig"),
      simulate: byToolkit("simulate"),
      output: byToolkit("output"),
    }).toEqual({
      modelling: [
        "blender_add_objects",
        "blender_edit_objects",
        "blender_settle_objects",
        "blender_shape_objects",
      ],
      surfacing: ["blender_set_material"],
      "light-and-camera": ["blender_set_camera", "blender_set_lighting"],
      motion: [
        "blender_animate",
        "blender_close_ups",
        "blender_frame_sheet",
        "blender_render_video",
      ],
      scatter: ["blender_scatter"],
      decals: ["blender_add_decal"],
      unwrap: ["blender_unwrap"],
      bake: ["blender_bake"],
      measure: ["blender_measure"],
      rig: ["blender_rig"],
      simulate: ["blender_simulate"],
      output: ["blender_export"],
    });
  });

  it("are each declared once, with words of their own, and hold at most the toolkit size", () => {
    const ids = toolkitDeclarations.map((toolkit) => toolkit.id);
    const tagged = new Set(
      studioTools.flatMap((tool) => (tool.toolkit ? [tool.toolkit] : [])),
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect([...tagged].sort()).toEqual([...ids].sort());
    for (const toolkit of toolkitDeclarations) {
      expect(toolkit.title).not.toBe("");
      expect(toolkit.summary).not.toBe("");
      expect(byToolkit(toolkit.id).length).toBeLessThanOrEqual(TOOLKIT_SIZE);
    }
  });
});
