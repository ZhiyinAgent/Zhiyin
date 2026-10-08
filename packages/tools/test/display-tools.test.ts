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
