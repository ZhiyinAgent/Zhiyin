import {
  ChartSvg,
  colors,
  dashes,
  extent,
  scale,
  type LegendEntry,
} from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import styles from "./views.module.css";

const marks = ["solid", "dashed", "dotted"] as const;

export function LineChartView({ data }: { data: ChartData }) {
  const series = data.series ?? [];
  const values = series.flatMap((set) => set.points.map((point) => point.y));
  const domain = extent(values);
  const spread = series[0]?.points ?? [];
  const ends = spread.length
    ? ([String(spread[0]!.x), String(spread[spread.length - 1]!.x)] as [
        string,
        string,
      ])
    : undefined;
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
          const step =
            (plot.right - plot.left) / Math.max(1, set.points.length - 1);
          const y = (value: number) =>
            scale(value, domain, [plot.bottom, plot.top]);
          return (
            <g key={set.name}>
              <polyline
                className={styles["task-chart__line"]}
                points={set.points
                  .map((point, i) => `${plot.left + i * step},${y(point.y)}`)
                  .join(" ")}
                style={{ stroke: colors[s % colors.length] }}
                strokeDasharray={dashes[marks[s % marks.length]!]}
              />
              {set.points.map((point, i) => (
                <circle
                  key={i}
                  cx={plot.left + i * step}
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
