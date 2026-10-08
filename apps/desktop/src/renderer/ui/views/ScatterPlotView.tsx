import {
  axisNumber,
  ChartSvg,
  colors,
  extent,
  scale,
  type LegendEntry,
} from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";

export function ScatterPlotView({ data }: { data: ChartData }) {
  const series = data.series ?? [];
  const points = series.flatMap((set) => set.points);
  const xDomain = extent(points.map((point) => Number(point.x)));
  const yDomain = extent(points.map((point) => point.y));
  const legend: LegendEntry[] = series.map((set, s) => ({
    name: set.name,
    colour: colors[s % colors.length]!,
    mark: s % 2 ? "diamond" : "circle",
  }));
  return (
    <ChartSvg
      data={data}
      yDomain={yDomain}
      legend={legend}
      xEnds={[axisNumber(xDomain[0]), axisNumber(xDomain[1])]}
    >
      {(plot) =>
        series.map((set, s) => (
          <g key={set.name}>
            {set.points.map((point, i) => {
              const x = scale(Number(point.x), xDomain, [
                plot.left,
                plot.right,
              ]);
              const y = scale(point.y, yDomain, [plot.bottom, plot.top]);
              const about = (
                <title>
                  {point.label ? `${point.label}: ` : ""}
                  {point.x}, {point.y}
                </title>
              );
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
                  {about}
                </rect>
              ) : (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="5"
                  style={{ fill: colors[s % colors.length] }}
                >
                  {about}
                </circle>
              );
            })}
          </g>
        ))
      }
    </ChartSvg>
  );
}
