import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

/**
 * Each chart tool with a call it accepts, and every text field it bounds: a
 * path into the call ("[]" is a list's first item) and its longest length.
 */
const charts: readonly [
  string,
  Record<string, unknown>,
  readonly (readonly [string, number])[],
][] = [
  [
    "render_bar_chart",
    { title: "Revenue", categories: [{ label: "Jan", value: 12 }] },
    [
      ["title", 160],
      ["categories[].label", 120],
      ["xLabel", 120],
      ["yLabel", 120],
      ["unit", 120],
      ["omitted", 500],
    ],
  ],
  [
    "render_histogram",
    { title: "Latency", values: [1, 2, 3] },
    [
      ["title", 160],
      ["xLabel", 120],
      ["yLabel", 120],
      ["unit", 120],
      ["omitted", 500],
    ],
  ],
  [
    "render_line_chart",
    {
      title: "Revenue",
      series: [{ name: "Actual", points: [{ x: "Jan", y: 12 }] }],
    },
    [
      ["title", 160],
      ["series[].name", 120],
      ["xLabel", 120],
      ["yLabel", 120],
      ["unit", 120],
      ["omitted", 500],
    ],
  ],
  [
    "render_scatter_plot",
    {
      title: "Height and weight",
      series: [{ name: "People", points: [{ x: 170, y: 65, label: "Ana" }] }],
    },
    [
      ["title", 160],
      ["series[].name", 120],
      ["series[].points[].label", 120],
      ["xLabel", 120],
      ["yLabel", 120],
      ["unit", 120],
      ["omitted", 500],
    ],
  ],
  [
    "render_box_plot",
    { title: "Response times", groups: [{ label: "API", values: [1, 2] }] },
    [
      ["title", 160],
      ["groups[].label", 120],
      ["xLabel", 120],
      ["yLabel", 120],
      ["unit", 120],
      ["omitted", 500],
    ],
  ],
];

type Schema = {
  properties?: Record<string, Schema>;
  items?: Schema;
  maxLength?: number;
  minLength?: number;
};

/** The schema a path names: each step a property, "[]" its list's items. */
function schemaAt(schema: Schema, path: string): Schema | undefined {
  let at: Schema | undefined = schema;
  for (const step of path.split(".")) {
    const list = step.endsWith("[]");
    at = at?.properties?.[list ? step.slice(0, -2) : step];
    if (list) at = at?.items;
  }
  return at;
}

/** The call with the field a path names set to `value`. */
function withField(
  call: Record<string, unknown>,
  path: string,
  value: string,
): Record<string, unknown> {
  const copy = structuredClone(call);
  let at: Record<string, unknown> = copy;
  const steps = path.split(".");
  steps.forEach((step, index) => {
    const list = step.endsWith("[]");
    const name = list ? step.slice(0, -2) : step;
    if (index === steps.length - 1) at[name] = value;
    else
      at = list
        ? (at[name] as Record<string, unknown>[])[0]!
        : (at[name] as Record<string, unknown>);
  });
  return copy;
}

describe("the chart tools' text bounds", () => {
  const tools = new WorkspaceTools(undefined, { shell: undefined });

  for (const [name, call, fields] of charts)
    for (const [path, longest] of fields)
      it(`${name} advertises ${path} up to ${longest} characters, as it enforces`, async () => {
        const spec = tools.list().find((tool) => tool.name === name);
        expect(schemaAt(spec?.inputSchema as Schema, path)).toMatchObject({
          type: "string",
          minLength: 1,
          maxLength: longest,
        });
        await expect(
          tools.inspect(name, withField(call, path, "x".repeat(longest))),
        ).resolves.toMatchObject({ ok: true });
        await expect(
          tools.inspect(name, withField(call, path, "x".repeat(longest + 1))),
        ).resolves.toMatchObject({ ok: false, correctable: true });
        await expect(
          tools.inspect(name, withField(call, path, "")),
        ).resolves.toMatchObject({ ok: false, correctable: true });
        // Counted in characters, as the schema's bound is, though an emoji
        // or a rarer Chinese character takes two JavaScript units.
        await expect(
          tools.inspect(name, withField(call, path, "😀".repeat(longest))),
        ).resolves.toMatchObject({ ok: true });
        await expect(
          tools.inspect(name, withField(call, path, "𠀀".repeat(longest + 1))),
        ).resolves.toMatchObject({ ok: false, correctable: true });
      });

  it("counts no spaces around a text, and refuses one of spaces alone", async () => {
    const call = {
      title: "Revenue",
      categories: [{ label: "Jan", value: 12 }],
    };

    const spaced = await tools.inspect("render_bar_chart", {
      ...call,
      title: ` ${"x".repeat(160)} `,
    });
    const blank = await tools.inspect("render_bar_chart", {
      ...call,
      xLabel: "   ",
    });

    expect(spaced.ok && JSON.parse(spaced.view?.source ?? "{}")).toMatchObject({
      title: "x".repeat(160),
    });
    expect(blank).toMatchObject({ ok: false, correctable: true });
  });

  it("keeps a chart's note on what it leaves out", async () => {
    const shown = await tools.inspect("render_bar_chart", {
      title: "Revenue",
      categories: [{ label: "Jan", value: 12 }],
      omitted: "February is still being counted.",
    });
    expect(shown.ok && JSON.parse(shown.view?.source ?? "{}")).toMatchObject({
      omitted: "February is still being counted.",
    });
  });
});
