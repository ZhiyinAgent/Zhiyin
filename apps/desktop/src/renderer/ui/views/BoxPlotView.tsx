import { ChartSvg, colors, extent, scale } from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import { boxSummary } from "./chartStatistics.js";
import styles from "./views.module.css";

export function BoxPlotView({ data }: { data: ChartData }) {
  const groups = data.groups ?? [];
  const domain = extent(groups.flatMap((group) => group.values));
  return (
    <ChartSvg data={data} yDomain={domain}>
      {(plot) => {
        const step = (plot.right - plot.left) / groups.length;
        const y = (value: number) =>
          scale(value, domain, [plot.bottom, plot.top]);
        return groups.map((group, i) => {
          const { low, q1, median, q3, high } = boxSummary(group.values);
          const x = plot.left + i * step + step / 2;
          const colour = colors[i % colors.length];
          return (
            <g key={group.label}>
              <line
                className={styles["task-chart__line"]}
                style={{ stroke: colour }}
                x1={x}
                x2={x}
                y1={y(low)}
                y2={y(high)}
              />
              <rect
                className={styles["task-chart__box"]}
                style={{ stroke: colour }}
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
                style={{ stroke: colour }}
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
        });
      }}
    </ChartSvg>
  );
}
