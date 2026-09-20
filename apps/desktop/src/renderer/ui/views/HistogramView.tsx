import { ChartSvg, colors, plot, scale } from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";

export function HistogramView({ data }: { data: ChartData }) {
  const values = data.values ?? [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const count =
    data.bins ?? Math.min(20, Math.max(1, Math.ceil(Math.sqrt(values.length))));
  const width = maximum === minimum ? 1 : (maximum - minimum) / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    start: minimum + index * width,
    count: 0,
  }));
  values.forEach((value) => {
    const index =
      maximum === minimum
        ? 0
        : Math.min(count - 1, Math.floor((value - minimum) / width));
    if (bins[index]) bins[index].count += 1;
  });
  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const step = (plot.right - plot.left) / count;
  return (
    <ChartSvg
      data={{ ...data, yLabel: data.yLabel ?? "Count" }}
      yDomain={[0, maxCount]}
    >
      {bins.map((bin, i) => {
        const y = scale(bin.count, [0, maxCount], [plot.bottom, plot.top]);
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
              {bin.start.toPrecision(3)}–{(bin.start + width).toPrecision(3)}:{" "}
              {bin.count}
            </title>
          </rect>
        );
      })}
    </ChartSvg>
  );
}
