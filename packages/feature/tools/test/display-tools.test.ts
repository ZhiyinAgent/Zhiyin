import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

const cases = [
  [
    "render_diagram",
    { title: "Flow", source: "flowchart LR\nA --> B" },
    "diagram",
  ],
  [
    "render_bar_chart",
    { title: "Revenue", categories: [{ label: "Jan", value: 12 }] },
    "bar-chart",
  ],
  [
    "render_line_chart",
    {
      title: "Revenue",
      series: [{ name: "Actual", points: [{ x: "Jan", y: 12 }] }],
    },
    "line-chart",
  ],
  [
    "render_scatter_plot",
    {
      title: "Quality",
      series: [{ name: "Trials", points: [{ x: 1, y: 2 }] }],
    },
    "scatter-plot",
  ],
  ["render_histogram", { title: "Latency", values: [10, 12, 18] }, "histogram"],
  [
    "render_box_plot",
    { title: "Latency", groups: [{ label: "A", values: [10, 12, 18] }] },
    "box-plot",
  ],
] as const;

describe("display tools", () => {
  it("advertises inert views even when no workspace folder is selected", () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    expect(tools.list().map((tool) => tool.name)).toEqual(
      expect.arrayContaining(cases.map(([name]) => name)),
    );
    expect(tools.list()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "read_file" })]),
    );
  });

  it.each(cases)(
    "validates and produces %s as a durable view",
    async (name, args, kind) => {
      const tools = new WorkspaceTools(undefined, { shell: undefined });
      await expect(tools.inspect(name, args)).resolves.toMatchObject({
        ok: true,
        requiresApproval: false,
        view: { kind, title: args.title },
      });
      await expect(tools.execute(name, args)).resolves.toMatchObject({
        ok: true,
        view: { kind, title: args.title },
      });
    },
  );

  it("rejects invalid chart data before a view reaches the renderer", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    await expect(
      tools.inspect("render_bar_chart", {
        title: "Broken",
        categories: [{ label: "A", value: Number.NaN }],
      }),
    ).resolves.toMatchObject({ ok: false, correctable: true });
    await expect(
      tools.inspect("render_histogram", { title: "Empty", values: [] }),
    ).resolves.toMatchObject({ ok: false, correctable: true });
  });

  it("draws a box plot's whiskers by Tukey's rule unless its range is asked for, and refuses any other rule", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    const groups = [{ label: "A", values: [1, 2, 3, 40] }];
    const whiskers = async (args: Record<string, unknown>) => {
      const asked = await tools.inspect("render_box_plot", args);
      if (!asked.ok || !asked.view) throw new Error("Refused.");
      return (JSON.parse(asked.view.source) as { whiskers?: string }).whiskers;
    };

    expect(await whiskers({ title: "Plain", groups })).toBe("tukey");
    expect(await whiskers({ title: "Range", groups, whiskers: "range" })).toBe(
      "range",
    );
    await expect(
      tools.inspect("render_box_plot", {
        title: "Other",
        groups,
        whiskers: "percentile",
      }),
    ).resolves.toMatchObject({
      ok: false,
      correctable: true,
      reason: expect.stringContaining(
        "“whiskers” must be one of: tukey, range",
      ),
    });
  });

  it.each(cases)(
    "offers %s a file to save its drawing to, an .svg the view names",
    async (name, args) => {
      const tools = new WorkspaceTools(undefined, { shell: undefined });
      const spec = tools.list().find((tool) => tool.name === name);

      expect(
        (spec?.inputSchema as { properties: Record<string, unknown> })
          .properties["save_to"],
      ).toMatchObject({ type: "string" });
      await expect(
        tools.inspect(name, { ...args, save_to: "charts/drawn.svg" }),
      ).resolves.toMatchObject({
        ok: true,
        view: { saveTo: "charts/drawn.svg" },
      });
      const refused = await tools.inspect(name, {
        ...args,
        save_to: "charts/drawn.png",
      });
      expect(refused).toMatchObject({
        ok: false,
        correctable: true,
        reason:
          "save_to names the .svg file the drawing is saved to, such as charts/sales.svg.",
      });
    },
  );

  it("advertises the histogram title bound it enforces", async () => {
    const tools = new WorkspaceTools(undefined, { shell: undefined });
    expect(
      tools.list().find((tool) => tool.name === "render_histogram"),
    ).toMatchObject({
      inputSchema: {
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
        },
      },
    });
    await expect(
      tools.inspect("render_histogram", { title: "", values: [1] }),
    ).resolves.toMatchObject({ ok: false, correctable: true });
    await expect(
      tools.inspect("render_histogram", {
        title: "x".repeat(161),
        values: [1],
      }),
    ).resolves.toMatchObject({ ok: false, correctable: true });
  });
});
