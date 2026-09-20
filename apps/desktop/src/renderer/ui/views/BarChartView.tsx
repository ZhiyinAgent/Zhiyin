import { ChartSvg, colors, extent, plot, scale } from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import styles from "./views.module.css";

export function BarChartView({ data }: { data: ChartData }) {
  const rows = data.categories ?? [];
  const domain = extent(rows.map((row) => row.value));
  const zero = scale(0, domain, [plot.bottom, plot.top]);
  const step = (plot.right - plot.left) / rows.length;
  return (
    <ChartSvg data={data} yDomain={domain}>
      {rows.map((row, index) => {
        const y = scale(row.value, domain, [plot.bottom, plot.top]);
        return (
          <g key={`${row.label}-${index}`}>
            <rect
              style={{ fill: colors[index % colors.length] }}
              x={plot.left + index * step + step * 0.16}
              y={Math.min(y, zero)}
              width={step * 0.68}
              height={Math.max(1, Math.abs(zero - y))}
            >
              <title>
                {row.label}: {row.value}
                {data.unit ?? ""}
              </title>
            </rect>
            <text
              className={styles["task-chart__tick"]}
              x={plot.left + index * step + step / 2}
              y={plot.bottom + 20}
              textAnchor="middle"
            >
              {row.label}
            </text>
          </g>
        );
      })}
    </ChartSvg>
  );
}
