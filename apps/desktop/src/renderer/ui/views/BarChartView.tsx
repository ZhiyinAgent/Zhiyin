import {
  ChartSvg,
  colors,
  extent,
  scale,
  textWidth,
  tickLineHeight,
} from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import styles from "./views.module.css";

/** Lines a bar's name may take before the rest is cut short. */
const maxLines = 3;

/**
 * A bar's name broken at spaces into lines no wider than `room`. A word too
 * wide on its own, or a name that needs more lines than allowed, is cut short
 * with an ellipsis; the whole name stays in the bar's tooltip and the Data tab.
 */
function nameLines(name: string, room: number): string[] {
  const lines: string[] = [];
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last !== undefined && textWidth(`${last} ${word}`) <= room)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const kept = lines.slice(0, maxLines);
  const cut = lines.length > maxLines;
  return kept.map((line, index) => {
    const ends = cut && index === kept.length - 1;
    if (!ends && textWidth(line) <= room) return line;
    let short = line;
    while (short.length > 1 && textWidth(`${short}…`) > room)
      short = short.slice(0, -1);
    return `${short.trimEnd()}…`;
  });
}

export function BarChartView({ data }: { data: ChartData }) {
  const rows = data.categories ?? [];
  const domain = extent(rows.map((row) => row.value));
  return (
    <ChartSvg
      data={data}
      yDomain={domain}
      tickLines={(plotWidth) =>
        Math.max(
          1,
          ...rows.map(
            (row) =>
              nameLines(row.label, plotWidth / Math.max(1, rows.length) - 8)
                .length,
          ),
        )
      }
    >
      {(plot) => {
        const zero = scale(0, domain, [plot.bottom, plot.top]);
        const step = (plot.right - plot.left) / rows.length;
        return rows.map((row, index) => {
          const y = scale(row.value, domain, [plot.bottom, plot.top]);
          const x = plot.left + index * step + step / 2;
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
                x={x}
                y={plot.bottom + 20}
                textAnchor="middle"
              >
                {nameLines(row.label, step - 8).map((line, at) => (
                  <tspan key={at} x={x} dy={at ? tickLineHeight : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        });
      }}
    </ChartSvg>
  );
}
