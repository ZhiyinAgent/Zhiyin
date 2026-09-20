import { ChartSvg, colors, extent, plot, scale } from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import styles from "./views.module.css";

function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return (
    sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
  );
}
export function BoxPlotView({ data }: { data: ChartData }) {
  const groups = data.groups ?? [];
  const domain = extent(groups.flatMap((group) => group.values));
  const step = (plot.right - plot.left) / groups.length;
  return (
    <ChartSvg data={data} yDomain={domain}>
      {groups.map((group, i) => {
        const low = Math.min(...group.values);
        const high = Math.max(...group.values);
        const q1 = quantile(group.values, 0.25);
        const median = quantile(group.values, 0.5);
        const q3 = quantile(group.values, 0.75);
        const x = plot.left + i * step + step / 2;
        const y = (value: number) =>
          scale(value, domain, [plot.bottom, plot.top]);
        return (
          <g key={group.label}>
            <line
              className={styles["task-chart__line"]}
              style={{ stroke: colors[i % colors.length] }}
              x1={x}
              x2={x}
              y1={y(low)}
              y2={y(high)}
            />
            <rect
              className={styles["task-chart__box"]}
              style={{ stroke: colors[i % colors.length] }}
              x={x - step * 0.22}
              width={step * 0.44}
              y={y(q3)}
              height={Math.max(1, y(q1) - y(q3))}
            >
              <title>
                {group.label}: {low}, {q1}, {median}, {q3}, {high}
              </title>
            </rect>
            <line
              className={styles["task-chart__line"]}
              style={{ stroke: colors[i % colors.length] }}
              x1={x - step * 0.22}
              x2={x + step * 0.22}
              y1={y(median)}
              y2={y(median)}
            />
            <text
              className={styles["task-chart__tick"]}
              x={x}
              y={plot.bottom + 20}
              textAnchor="middle"
            >
              {group.label}
            </text>
          </g>
        );
      })}
    </ChartSvg>
  );
}
