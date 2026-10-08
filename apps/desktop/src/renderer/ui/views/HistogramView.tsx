import { axisNumber, ChartSvg, colors, scale } from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import { histogramBins } from "./chartStatistics.js";
import styles from "./views.module.css";

/** Edge labels closer than this would run into each other, so some are skipped. */
const edgeSpacing = 48;

export function HistogramView({ data }: { data: ChartData }) {
  const bins = histogramBins(data);
  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const edges = [...bins.map((bin) => bin.start), bins.at(-1)?.end ?? 0];
  return (
    <ChartSvg
      data={{ ...data, yLabel: data.yLabel ?? "Count" }}
      yDomain={[0, maxCount]}
      unitOn="x"
      counts
    >
      {(plot) => {
        const step = (plot.right - plot.left) / bins.length;
        const every = Math.max(1, Math.ceil(edgeSpacing / step));
        return (
          <>
            {bins.map((bin, i) => {
              const y = scale(
                bin.count,
                [0, maxCount],
                [plot.bottom, plot.top],
              );
              return (
                <rect
                  key={i}
                  style={{ fill: colors[0] }}
                  x={plot.left + i * step + 1}
                  y={y}
                  width={Math.max(1, step - 2)}
                  height={plot.bottom - y}
                >
                  <title>
                    {axisNumber(bin.start)} to {axisNumber(bin.end)}
                    {data.unit ? ` ${data.unit}` : ""}: {bin.count}
                  </title>
                </rect>
              );
            })}
            {edges.map((edge, i) =>
              i % every === 0 || i === edges.length - 1 ? (
                <g key={i}>
                  <line
                    className={styles["task-chart__axis"]}
                    x1={plot.left + i * step}
                    x2={plot.left + i * step}
                    y1={plot.bottom}
                    y2={plot.bottom + 5}
                  />
                  <text
                    className={styles["task-chart__tick"]}
                    x={plot.left + i * step}
                    y={plot.bottom + 20}
                    textAnchor="middle"
                  >
                    {axisNumber(edge)}
                  </text>
                </g>
              ) : null,
            )}
          </>
        );
      }}
    </ChartSvg>
  );
}
