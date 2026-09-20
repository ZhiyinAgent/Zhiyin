import { ChartSvg, colors, extent, plot, scale } from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import styles from "./views.module.css";

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
  return (
    <ChartSvg data={data} yDomain={domain} {...(ends ? { xEnds: ends } : {})}>
      {series.map((set, s) => {
        const step =
          (plot.right - plot.left) / Math.max(1, set.points.length - 1);
        const points = set.points
          .map(
            (point, i) =>
              `${plot.left + i * step},${scale(point.y, domain, [plot.bottom, plot.top])}`,
          )
          .join(" ");
        return (
          <g key={set.name}>
            <polyline
              className={styles["task-chart__line"]}
              points={points}
              style={{ stroke: colors[s % colors.length] }}
              strokeDasharray={
                s % 3 === 1 ? "8 5" : s % 3 === 2 ? "2 5" : undefined
              }
            />
            <text
              className={styles["task-chart__legend"]}
              x={plot.left + s * 120}
              y="16"
              style={{ fill: colors[s % colors.length] }}
            >
              {set.name}
              {s % 3 === 1
                ? " — dashed"
                : s % 3 === 2
                  ? " — dotted"
                  : " — solid"}
            </text>
            {set.points.map((point, i) => (
              <circle
                key={i}
                cx={plot.left + i * step}
                cy={scale(point.y, domain, [plot.bottom, plot.top])}
                r="4"
                style={{ fill: colors[s % colors.length] }}
              >
                <title>
                  {String(point.x)}: {point.y}
                  {data.unit ?? ""}
                </title>
              </circle>
            ))}
          </g>
        );
      })}
    </ChartSvg>
  );
}
