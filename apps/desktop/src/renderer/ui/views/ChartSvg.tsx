import type { ReactNode } from "react";
import type { ChartData } from "./chartData.js";
import styles from "./views.module.css";

export const chartWidth = 720;
export const chartHeight = 360;
export const plot = { left: 64, top: 24, right: 694, bottom: 304 };
export const colors = [
  "#f06b52",
  "#76b7b0",
  "#d8b56a",
  "#8fa7d8",
  "#bf8bd1",
  "#7fc27f",
  "#df8eac",
  "#94a3a0",
];

export function extent(values: number[]): [number, number] {
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 0);
  return minimum === maximum ? [minimum - 1, maximum + 1] : [minimum, maximum];
}

export function scale(
  value: number,
  domain: [number, number],
  range: [number, number],
): number {
  return (
    range[0] +
    ((value - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0])
  );
}

/** Trailing zeroes read as false precision on an axis; 40 is not 40.000. */
export function axisNumber(value: number): string {
  return Number(value.toPrecision(3)).toString();
}

export function ChartSvg({
  data,
  yDomain,
  xEnds,
  children,
}: {
  data: ChartData;
  /** The values the vertical axis spans. Without it the chart is a shape, not a claim. */
  yDomain?: [number, number];
  /** Where the horizontal axis starts and ends, for charts whose marks carry no label of their own. */
  xEnds?: [string, string];
  children: ReactNode;
}) {
  const ticks = (
    yDomain ? [yDomain[0], (yDomain[0] + yDomain[1]) / 2, yDomain[1]] : []
  ).map((value) => ({
    value,
    y: scale(value, yDomain ?? [0, 1], [plot.bottom, plot.top]) + 4,
  }));
  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      role="img"
      aria-label={data.title}
    >
      <title>{data.title}</title>
      <line
        className={styles["task-chart__axis"]}
        x1={plot.left}
        y1={plot.top}
        x2={plot.left}
        y2={plot.bottom}
      />
      <line
        className={styles["task-chart__axis"]}
        x1={plot.left}
        y1={plot.bottom}
        x2={plot.right}
        y2={plot.bottom}
      />
      {ticks.map((tick) => (
        <text
          key={tick.value}
          className={styles["task-chart__tick"]}
          x={plot.left - 8}
          y={tick.y}
          textAnchor="end"
        >
          {axisNumber(tick.value)}
        </text>
      ))}
      {xEnds && (
        <>
          <text
            className={styles["task-chart__tick"]}
            x={plot.left}
            y={plot.bottom + 20}
            textAnchor="start"
          >
            {xEnds[0]}
          </text>
          <text
            className={styles["task-chart__tick"]}
            x={plot.right}
            y={plot.bottom + 20}
            textAnchor="end"
          >
            {xEnds[1]}
          </text>
        </>
      )}
      {children}
      {data.xLabel && (
        <text
          className={styles["task-chart__label"]}
          x={(plot.left + plot.right) / 2}
          y="350"
          textAnchor="middle"
        >
          {data.xLabel}
        </text>
      )}
      {data.yLabel && (
        <text
          className={styles["task-chart__label"]}
          transform="rotate(-90 16 164)"
          x="16"
          y="164"
          textAnchor="middle"
        >
          {data.yLabel}
          {data.unit ? ` (${data.unit})` : ""}
        </text>
      )}
    </svg>
  );
}
