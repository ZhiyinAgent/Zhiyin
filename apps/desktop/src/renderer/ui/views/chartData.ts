import type { ViewKind } from "@zhiyin/contract";

export type ChartKind = Exclude<ViewKind, "diagram">;

type Point = { x: string | number; y: number; label?: string };
type Series = { name: string; points: Point[] };
export type ChartData = {
  kind: ChartKind;
  title: string;
  xLabel?: string;
  yLabel?: string;
  unit?: string;
  omitted?: string;
  categories?: { label: string; value: number }[];
  series?: Series[];
  values?: number[];
  bins?: number;
  groups?: { label: string; values: number[] }[];
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Why data cannot be drawn, in words that serve two readers: the model, which
 * is handed this when a chart it asked for is refused and repairs the chart
 * from it, and a person looking at a stored chart that no longer draws.
 */
const noData = "There is no data to chart.";

function tooMany(what: string, count: number, allowed: number): string {
  return `This chart has too many ${what} to draw (${count} of ${allowed} allowed).`;
}

/** The first problem found, or undefined when the data can be drawn. */
type Check = (value: Record<string, unknown>) => string | undefined;

const seriesProblem =
  (lines: string, maximumPoints: number, numericX: boolean): Check =>
  (value) => {
    if (!Array.isArray(value.series) || value.series.length === 0)
      return noData;
    if (value.series.length > 8) return tooMany(lines, value.series.length, 8);
    for (const series of value.series) {
      if (!record(series) || typeof series.name !== "string")
        return "Each series needs a name.";
      if (!Array.isArray(series.points) || series.points.length === 0)
        return noData;
      if (series.points.length > maximumPoints)
        return `The series "${series.name}" has too many points to draw (${series.points.length} of ${maximumPoints} allowed).`;
      const drawable = series.points.every(
        (point) =>
          record(point) &&
          finite(point.y) &&
          (numericX
            ? finite(point.x)
            : finite(point.x) || typeof point.x === "string"),
      );
      if (!drawable)
        return numericX
          ? "Each point needs a number for x and a number for y."
          : "Each point needs a number for y, and an x that is a number or a name.";
    }
    return undefined;
  };

/** What each kind of chart must hold to be drawn. */
const chartChecks: Record<ChartKind, Check> = {
  "bar-chart": (value) => {
    if (!Array.isArray(value.categories) || value.categories.length === 0)
      return noData;
    if (value.categories.length > 100)
      return tooMany("bars", value.categories.length, 100);
    return value.categories.every(
      (row) =>
        record(row) && typeof row.label === "string" && finite(row.value),
    )
      ? undefined
      : "Each bar needs a label and a number.";
  },
  "line-chart": seriesProblem("lines", 500, false),
  "scatter-plot": seriesProblem("series", 1000, true),
  histogram: (value) => {
    if (!Array.isArray(value.values) || value.values.length === 0)
      return noData;
    if (value.values.length > 2000)
      return tooMany("values", value.values.length, 2000);
    if (!value.values.every(finite)) return "Every value must be a number.";
    if (
      value.bins !== undefined &&
      !(
        Number.isInteger(value.bins) &&
        Number(value.bins) >= 1 &&
        Number(value.bins) <= 50
      )
    )
      return "The number of bins must be a whole number from 1 to 50.";
    return undefined;
  },
  "box-plot": (value) => {
    if (!Array.isArray(value.groups) || value.groups.length === 0)
      return noData;
    if (value.groups.length > 40)
      return tooMany("groups", value.groups.length, 40);
    for (const group of value.groups) {
      if (!record(group) || typeof group.label !== "string")
        return "Each group needs a label.";
      if (!Array.isArray(group.values) || group.values.length === 0)
        return `The group "${group.label}" has no values.`;
      if (group.values.length > 1000)
        return `The group "${group.label}" has too many values to draw (${group.values.length} of 1000 allowed).`;
      if (!group.values.every(finite)) return "Every value must be a number.";
    }
    return undefined;
  },
};

export function parseChartData(kind: ChartKind, source: string): ChartData {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("The chart data could not be read.");
  }
  if (!record(value) || value.kind !== kind || typeof value.title !== "string")
    throw new Error(
      `The chart data needs a title, and its kind must be "${kind}".`,
    );
  const problem = chartChecks[kind](value);
  if (problem) throw new Error(problem);
  return value as ChartData;
}
