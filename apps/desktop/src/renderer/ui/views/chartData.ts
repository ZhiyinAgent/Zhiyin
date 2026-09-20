import type { ViewKind } from "@zhiyin/contract";

export type Point = { x: string | number; y: number; label?: string };
export type Series = { name: string; points: Point[] };
export type ChartData = {
  kind: Exclude<ViewKind, "diagram">;
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

export function parseChartData(
  kind: Exclude<ViewKind, "diagram">,
  source: string,
): ChartData {
  const value: unknown = JSON.parse(source);
  if (!record(value) || value.kind !== kind || typeof value.title !== "string")
    throw new Error("The stored chart data is invalid.");
  if (
    kind === "bar-chart" &&
    (!Array.isArray(value.categories) ||
      !value.categories.length ||
      value.categories.length > 100 ||
      value.categories.some(
        (row) =>
          !record(row) || typeof row.label !== "string" || !finite(row.value),
      ))
  )
    throw new Error("The bar data is invalid.");
  if (
    (kind === "line-chart" || kind === "scatter-plot") &&
    (!Array.isArray(value.series) ||
      !value.series.length ||
      value.series.length > 8 ||
      value.series.some(
        (series) =>
          !record(series) ||
          typeof series.name !== "string" ||
          !Array.isArray(series.points) ||
          !series.points.length ||
          series.points.length > (kind === "scatter-plot" ? 1000 : 500) ||
          series.points.some(
            (point) =>
              !record(point) ||
              !finite(point.y) ||
              (kind === "scatter-plot"
                ? !finite(point.x)
                : !(finite(point.x) || typeof point.x === "string")),
          ),
      ))
  )
    throw new Error("The series data is invalid.");
  if (
    kind === "histogram" &&
    (!Array.isArray(value.values) ||
      !value.values.length ||
      value.values.length > 2000 ||
      !value.values.every(finite) ||
      (value.bins !== undefined &&
        (!Number.isInteger(value.bins) ||
          Number(value.bins) < 1 ||
          Number(value.bins) > 50)))
  )
    throw new Error("The histogram data is invalid.");
  if (
    kind === "box-plot" &&
    (!Array.isArray(value.groups) ||
      !value.groups.length ||
      value.groups.length > 40 ||
      value.groups.some(
        (group) =>
          !record(group) ||
          typeof group.label !== "string" ||
          !Array.isArray(group.values) ||
          !group.values.length ||
          group.values.length > 1000 ||
          !group.values.every(finite),
      ))
  )
    throw new Error("The box-plot data is invalid.");
  return value as ChartData;
}
