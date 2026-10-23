import { dataSpan, endLabel, lineAxis, timeOf } from "./chartAxes.js";
import {
  ChartSvg,
  colors,
  dashes,
  scale,
  type LegendEntry,
  type Plot,
} from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import styles from "./views.module.css";

const marks = ["solid", "dashed", "dotted"] as const;

type Point = NonNullable<ChartData["series"]>[number]["points"][number];

export function LineChartView({ data }: { data: ChartData }) {
  const series = data.series ?? [];
  const values = series.flatMap((set) => set.points.map((point) => point.y));
  const domain = dataSpan(values);
  // Every series is drawn against one x axis, so the same x is the same place.
  const axis = lineAxis(series);
  const index = new Map(
    axis.kind === "category"
      ? axis.order.map((x, at) => [String(x), at] as const)
      : [],
  );
  /** Where a point sits along a number or time axis. */
  const along = (point: Point) =>
    axis.kind === "time" ? (timeOf(point.x) ?? 0) : Number(point.x);
  const xs = series.flatMap((set) => set.points);
  const earliest = xs.reduce<Point | undefined>(
    (best, point) => (!best || along(point) < along(best) ? point : best),
    undefined,
  );
  const latest = xs.reduce<Point | undefined>(
    (best, point) => (!best || along(point) > along(best) ? point : best),
    undefined,
  );
  const ends: [string, string] | undefined =
    axis.kind === "number"
      ? [endLabel(axis.domain[0]), endLabel(axis.domain[1])]
      : axis.kind === "time"
        ? earliest && latest
          ? [String(earliest.x), String(latest.x)]
          : undefined
        : axis.order.length
          ? [String(axis.order[0]), String(axis.order[axis.order.length - 1])]
          : undefined;
  const xOf = (point: Point, plot: Plot) =>
    axis.kind !== "category"
      ? scale(along(point), axis.domain, [plot.left, plot.right])
      : plot.left +
        (index.get(String(point.x)) ?? 0) *
          ((plot.right - plot.left) / Math.max(1, axis.order.length - 1));
  /**
   * A series' points in the axis's order, as runs a line joins: a value the
   * series has no point for leaves a gap instead of a line drawn across it.
   */
  const runs = (points: readonly Point[]): Point[][] => {
    if (axis.kind !== "category")
      return [[...points].sort((a, b) => along(a) - along(b))];
    const ordered = [...points].sort(
      (a, b) => (index.get(String(a.x)) ?? 0) - (index.get(String(b.x)) ?? 0),
    );
    const split: Point[][] = [];
    ordered.forEach((point, at) => {
      const previous = ordered[at - 1];
      const joined =
        previous !== undefined &&
        (index.get(String(point.x)) ?? 0) -
          (index.get(String(previous.x)) ?? 0) ===
          1;
      if (joined) split[split.length - 1]!.push(point);
      else split.push([point]);
    });
    return split;
  };
  const legend: LegendEntry[] = series.map((set, s) => ({
    name: set.name,
    colour: colors[s % colors.length]!,
    mark: marks[s % marks.length]!,
  }));
  return (
    <ChartSvg
      data={data}
      yDomain={domain}
      legend={legend}
      {...(ends ? { xEnds: ends } : {})}
    >
      {(plot) =>
        series.map((set, s) => {
          const y = (value: number) =>
            scale(value, domain, [plot.bottom, plot.top]);
          return (
            <g key={set.name}>
              {runs(set.points)
                .filter((run) => run.length > 1)
                .map((run, r) => (
                  <polyline
                    key={r}
                    className={styles["task-chart__line"]}
                    points={run
                      .map((point) => `${xOf(point, plot)},${y(point.y)}`)
                      .join(" ")}
                    style={{ stroke: colors[s % colors.length] }}
                    strokeDasharray={dashes[marks[s % marks.length]!]}
                  />
                ))}
              {set.points.map((point, i) => (
                <circle
                  key={i}
                  cx={xOf(point, plot)}
                  cy={y(point.y)}
                  r="4"
                  style={{ fill: colors[s % colors.length] }}
                >
                  <title>
                    {set.name}, {String(point.x)}: {point.y}
                    {data.unit ?? ""}
                  </title>
                </circle>
              ))}
            </g>
          );
        })
      }
    </ChartSvg>
  );
}
