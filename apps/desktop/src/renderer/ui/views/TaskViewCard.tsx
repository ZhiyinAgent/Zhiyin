import type { ArtifactExport, TaskView, ViewKind } from "@zhiyin/contract";
import { BarChartView } from "./BarChartView.js";
import { BoxPlotView } from "./BoxPlotView.js";
import { DiagramView } from "./DiagramView.js";
import { HistogramView } from "./HistogramView.js";
import { LineChartView } from "./LineChartView.js";
import { ScatterPlotView } from "./ScatterPlotView.js";
import { parseChartData, type ChartData } from "./chartData.js";
import { ViewFrame } from "./ViewFrame.js";
import styles from "./views.module.css";

/** Damaged stored data is a state to draw, not an exception thrown at React. */
function readChartData(
  kind: Exclude<ViewKind, "diagram">,
  source: string,
): ChartData | null {
  try {
    return parseChartData(kind, source);
  } catch {
    return null;
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
  const data = readChartData(view.kind, view.source);
  if (!data)
    return (
      <section
        className={styles["task-view"]}
        aria-label={`${view.title} view`}
      >
        <header className={styles["task-view__header"]}>
          <h3>{view.title}</h3>
        </header>
        <div className={styles["task-view__failure"]} role="alert">
          This chart could not be drawn. Its stored data may be damaged.
        </div>
      </section>
    );
  const chart =
    view.kind === "bar-chart" ? (
      <BarChartView data={data} />
    ) : view.kind === "line-chart" ? (
      <LineChartView data={data} />
    ) : view.kind === "scatter-plot" ? (
      <ScatterPlotView data={data} />
    ) : view.kind === "histogram" ? (
      <HistogramView data={data} />
    ) : (
      <BoxPlotView data={data} />
    );
  return (
    <ViewFrame
      title={view.title}
      kind={view.kind}
      source={JSON.stringify(data, null, 2)}
      {...(onSave ? { onSave } : {})}
    >
      {chart}
      {data.omitted && (
        <p className={styles["task-view__note"]}>Not shown: {data.omitted}</p>
      )}
    </ViewFrame>
  );
}
