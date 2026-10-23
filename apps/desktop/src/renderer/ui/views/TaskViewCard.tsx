import type { ArtifactExport, TaskView } from "@zhiyin/contract";
import type { ReactNode } from "react";
import { BarChartView } from "./BarChartView.js";
import { BoxPlotView } from "./BoxPlotView.js";
import { ChartTable } from "./ChartTable.js";
import { DiagramView } from "./DiagramView.js";
import { HistogramView } from "./HistogramView.js";
import { LineChartView } from "./LineChartView.js";
import { ScatterPlotView } from "./ScatterPlotView.js";
import { parseChartData, type ChartData, type ChartKind } from "./chartData.js";
import { ViewFrame } from "./ViewFrame.js";
import styles from "./views.module.css";

const chartDrawings: Record<
  ChartKind,
  (props: { data: ChartData }) => ReactNode
> = {
  "bar-chart": BarChartView,
  "line-chart": LineChartView,
  "scatter-plot": ScatterPlotView,
  histogram: HistogramView,
  "box-plot": BoxPlotView,
};

/**
 * A kind arrives as data, so the type says nothing about it at run time. One
 * this build has no drawing for is said to be unknown, not drawn as another.
 */
const drawable = (kind: string): kind is ChartKind =>
  Object.hasOwn(chartDrawings, kind);

/**
 * Damaged stored data is a state to draw, not an exception thrown at React,
 * and says what is wrong with it rather than only that something is.
 */
function readChartData(
  kind: ChartKind,
  source: string,
): { data: ChartData } | { problem: string } {
  try {
    return { data: parseChartData(kind, source) };
  } catch (error) {
    return {
      problem:
        error instanceof Error
          ? error.message
          : "The chart data could not be read.",
    };
  }
}

export function TaskViewCard({
  view,
  onSave,
}: {
  view: TaskView;
  onSave?: (svg: string) => Promise<ArtifactExport>;
}) {
  if (view.kind === "diagram")
    return (
      <ViewFrame
        title={view.title}
        kind={view.kind}
        source={view.source}
        zoomable
        {...(onSave ? { onSave } : {})}
      >
        <DiagramView id={view.id} source={view.source} />
      </ViewFrame>
    );
  if (!drawable(view.kind))
    return (
      <ViewFrame title={view.title} kind={view.kind} source={view.source}>
        <div className={styles["task-view__failure"]} role="alert">
          This kind of result can't be shown in this version of Zhiyin.
        </div>
      </ViewFrame>
    );
  const read = readChartData(view.kind, view.source);
  if ("problem" in read)
    return (
      <ViewFrame title={view.title} kind={view.kind} source={view.source}>
        <div className={styles["task-view__failure"]} role="alert">
          {read.problem}
        </div>
      </ViewFrame>
    );
  const { data } = read;
  const Chart = chartDrawings[view.kind];
  return (
    <ViewFrame
      title={view.title}
      kind={view.kind}
      source={JSON.stringify(data, null, 2)}
      table={<ChartTable data={data} />}
      {...(onSave ? { onSave } : {})}
    >
      <Chart data={data} />
      {data.omitted && (
        <p className={styles["task-view__note"]}>Not shown: {data.omitted}</p>
      )}
    </ViewFrame>
  );
}
