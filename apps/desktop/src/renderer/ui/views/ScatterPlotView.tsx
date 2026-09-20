import {
  axisNumber,
  ChartSvg,
  colors,
  extent,
  plot,
  scale,
} from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import styles from "./views.module.css";

export function ScatterPlotView({ data }: { data: ChartData }) {
  const series = data.series ?? [];
  const points = series.flatMap((set) => set.points);
  const xDomain = extent(points.map((point) => Number(point.x)));
  const yDomain = extent(points.map((point) => point.y));
  return (
    <ChartSvg
      data={data}
      yDomain={yDomain}
      xEnds={[axisNumber(xDomain[0]), axisNumber(xDomain[1])]}
    >
      {series.map((set, s) => (
        <g key={set.name}>
          <text
            className={styles["task-chart__legend"]}
            x={plot.left + s * 120}
            y="16"
            style={{ fill: colors[s % colors.length] }}
          >
            {set.name} {s % 2 ? "◆" : "●"}
          </text>
          {set.points.map((point, i) => {
            const x = scale(Number(point.x), xDomain, [plot.left, plot.right]);
            const y = scale(point.y, yDomain, [plot.bottom, plot.top]);
            return s % 2 ? (
              <rect
                key={i}
                x={x - 4}
                y={y - 4}
                width="8"
                height="8"
                transform={`rotate(45 ${x} ${y})`}
                style={{ fill: colors[s % colors.length] }}
              >
                <title>
                  {point.label ? `${point.label}: ` : ""}
                  {point.x}, {point.y}
                </title>
              </rect>
            ) : (
              <circle
                key={i}
                cx={x}
                cy={y}
                r="5"
                style={{ fill: colors[s % colors.length] }}
              >
                <title>
                  {point.label ? `${point.label}: ` : ""}
                  {point.x}, {point.y}
                </title>
              </circle>
            );
          })}
        </g>
      ))}
    </ChartSvg>
  );
}
