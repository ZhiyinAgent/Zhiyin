import { axisNumber } from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import { boxSummary, histogramBins } from "./chartStatistics.js";
import styles from "./views.module.css";

/** Enough to check a chart against; the rest is one click away as JSON. */
const shownRows = 200;

type Table = { columns: string[]; rows: string[][] };

const withUnit = (label: string, unit: string | undefined) =>
  unit ? `${label} (${unit})` : label;

const exact = (value: number) => String(value);

/** A chart's data as rows a person can read, named by the chart's own axes. */
function tableOf(data: ChartData): Table {
  const value = withUnit(data.yLabel ?? "Value", data.unit);
  switch (data.kind) {
    case "bar-chart":
      return {
        columns: [data.xLabel ?? "Category", value],
        rows: (data.categories ?? []).map((row) => [
          row.label,
          exact(row.value),
        ]),
      };
    case "line-chart": {
      const series = data.series ?? [];
      const xs = [
        ...new Set(series.flatMap((set) => set.points.map((p) => p.x))),
      ];
      return {
        columns: [
          data.xLabel ?? "x",
          ...series.map((set) => withUnit(set.name, data.unit)),
        ],
        rows: xs.map((x) => [
          String(x),
          ...series.map((set) => {
            const point = set.points.find((p) => p.x === x);
            return point ? exact(point.y) : "";
          }),
        ]),
      };
    }
    case "scatter-plot": {
      const series = data.series ?? [];
      const labelled = series.some((set) => set.points.some((p) => p.label));
      return {
        columns: [
          "Series",
          ...(labelled ? ["Label"] : []),
          data.xLabel ?? "x",
          value,
        ],
        rows: series.flatMap((set) =>
          set.points.map((point) => [
            set.name,
            ...(labelled ? [point.label ?? ""] : []),
            String(point.x),
            exact(point.y),
          ]),
        ),
      };
    }
    case "histogram":
      return {
        columns: [withUnit(data.xLabel ?? "Value", data.unit), "Count"],
        rows: histogramBins(data).map((bin) => [
          `${axisNumber(bin.start)} to ${axisNumber(bin.end)}`,
          exact(bin.count),
        ]),
      };
    case "box-plot":
      return {
        columns: [
          data.xLabel ?? "Group",
          "Values",
          "Lowest",
          "Lower quartile",
          "Median",
          "Upper quartile",
          "Highest",
        ],
        rows: (data.groups ?? []).map((group) => {
          const box = boxSummary(group.values);
          return [
            group.label,
            exact(group.values.length),
            ...[box.low, box.q1, box.median, box.q3, box.high].map(axisNumber),
          ];
        }),
      };
  }
}

export function ChartTable({ data }: { data: ChartData }) {
  const { columns, rows } = tableOf(data);
  return (
    <div className={styles["task-table"]}>
      <table aria-label={`${data.title} data`}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shownRows).map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) =>
                column === 0 ? (
                  <th key={column} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={column}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shownRows && (
        <p className={styles["task-view__note"]}>
          The first {shownRows} of {rows.length} rows. All of them are under
          Technical.
        </p>
      )}
    </div>
  );
}
