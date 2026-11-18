/**
 * What the window decided when it drew a view, said in words for the model
 * that asked for it: the axes it chose, the bins it made, the names it cut
 * short. Each fact comes from the same functions the drawing used, or from the
 * drawing itself, so it says what the person sees.
 */

import {
  axisEnds,
  dataEnds,
  dataSpan,
  endLabel,
  lineAxis,
  numberOf,
  timeOf,
} from "./chartAxes.js";
import { axisNumber, extent, textWidth } from "./ChartSvg.js";
import type { ChartData } from "./chartData.js";
import { boxSummary, histogramBins } from "./chartStatistics.js";

/** The most names one fact lists; the rest are counted. */
const listed = 10;

function some(names: readonly string[], most = listed): string {
  const shown = names.slice(0, most).join(", ");
  const rest = names.length - most;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

const span = ([low, high]: readonly [number, number]) =>
  `${endLabel(low)} to ${endLabel(high)}`;

/** The drawing's own size, as its view box gives it. */
function drawnSize(drawing: SVGSVGElement | null): string | undefined {
  const [, , width, height] = (drawing?.getAttribute("viewBox") ?? "")
    .split(/\s+/)
    .map(Number);
  return width && height
    ? `Drawn ${Math.round(width)} × ${Math.round(height)} px.`
    : undefined;
}

function barFacts(data: ChartData, drawing: SVGSVGElement | null): string[] {
  const rows = data.categories ?? [];
  const facts = [
    `${rows.length} ${rows.length === 1 ? "bar" : "bars"}, each starting at zero; the value axis spans ${span(extent(rows.map((row) => row.value)))}.`,
  ];
  // Each bar's name is the one text drawn in lines, in the bars' order; a
  // name with no words is drawn with no lines.
  const names = [...(drawing?.querySelectorAll("text") ?? [])].filter((text) =>
    text.querySelector("tspan"),
  );
  const words = (name: string) => name.split(/\s+/).filter(Boolean).join(" ");
  const named = rows.filter((row) => words(row.label));
  const cut = named.flatMap((row, index) => {
    const drawn = [...(names[index]?.querySelectorAll("tspan") ?? [])]
      .map((line) => line.textContent ?? "")
      .join(" ");
    return drawn !== words(row.label) ? [`“${drawn}” for “${row.label}”`] : [];
  });
  if (cut.length)
    facts.push(
      `${cut.length} of ${rows.length} bar names ${cut.length === 1 ? "is" : "are"} cut short to fit under their bars: ${some(cut)}. The full names are in each bar's tooltip and the Data tab.`,
    );
  return facts;
}

function lineFacts(data: ChartData): string[] {
  const series = data.series ?? [];
  const axis = lineAxis(series);
  const xs = series.flatMap((set) => set.points.map((point) => point.x));
  const facts: string[] = [];
  if (axis.kind === "number")
    facts.push(`The x axis is numeric, from ${span(axis.domain)}.`);
  else if (axis.kind === "time") {
    const [first, last] = axisEnds(axis, xs) ?? ["", ""];
    facts.push(`The x axis is time, from ${first} to ${last}.`);
  } else {
    const dates = xs.filter((x) => timeOf(x) !== undefined);
    const numbers = xs.filter((x) => numberOf(x) !== undefined);
    const odd = (keep: (x: string | number) => boolean) =>
      xs.find((x) => !keep(x));
    // A time or number axis given up for one value is the silent change.
    const because =
      dates.length > xs.length / 2
        ? ` It is not time, because “${String(odd((x) => timeOf(x) !== undefined))}” is not an ISO date.`
        : numbers.length > xs.length / 2
          ? ` It is not numeric, because “${String(odd((x) => numberOf(x) !== undefined))}” is not a number.`
          : "";
    facts.push(
      `The x axis has ${axis.order.length} categories, evenly spaced, in this order: ${some(axis.order.map(String), 20)}.${because}`,
    );
  }
  facts.push(
    `The y axis spans ${span(dataSpan(series.flatMap((set) => set.points.map((point) => point.y))))}.`,
  );
  return facts;
}

function scatterFacts(data: ChartData): string[] {
  const points = (data.series ?? []).flatMap((set) => set.points);
  const xs = points.map((point) => Number(point.x));
  return [
    `${points.length} points; the x axis spans ${span(dataEnds(xs))}, the y axis ${span(dataSpan(points.map((point) => point.y)))}.`,
  ];
}

function histogramFacts(data: ChartData): string[] {
  const bins = histogramBins(data);
  const first = bins[0]!;
  const width = first.end - first.start;
  const chosen =
    data.bins === undefined
      ? `${bins.length} bins, the fewer of 20 and the square root of the ${data.values?.length ?? 0} values, since none was given`
      : `${bins.length} bins`;
  return [
    `${chosen}, each ${axisNumber(width)} wide, from ${axisNumber(first.start)} to ${axisNumber(bins.at(-1)!.end)}. Counts: ${bins.map((bin) => bin.count).join(", ")}.`,
  ];
}

function boxFacts(data: ChartData, drawing: SVGSVGElement | null): string[] {
  const groups = data.groups ?? [];
  const range = data.whiskers === "range";
  const facts = [
    range
      ? "The box spans the first to the third quartile, with the median marked; the whiskers span each group's minimum and maximum, and outliers are not marked."
      : "The box spans the first to the third quartile, with the median marked; each whisker reaches the furthest value within 1.5 times the box's height of it (Tukey's rule), and values beyond are drawn as dots.",
    ...groups.slice(0, 40).map((group) => {
      const box = boxSummary(group.values, data.whiskers);
      const middle = `first quartile ${axisNumber(box.q1)}, median ${axisNumber(box.median)}, third quartile ${axisNumber(box.q3)}`;
      if (range)
        return `${group.label}: minimum ${axisNumber(box.low)}, ${middle}, maximum ${axisNumber(box.high)}.`;
      const beyond = box.outliers.length
        ? `${box.outliers.length} outlier${box.outliers.length === 1 ? "" : "s"}: ${box.outliers.slice(0, 10).map(axisNumber).join(", ")}${box.outliers.length > 10 ? ` and ${box.outliers.length - 10} more` : ""}`
        : "no outliers";
      return `${group.label}: lower whisker ${axisNumber(box.low)}, ${middle}, upper whisker ${axisNumber(box.high)}; ${beyond}.`;
    }),
  ];
  // Group names are drawn whole, centred under their boxes one share of the
  // plot apart, so two neighbours overlap when their half widths add up to
  // more than that share.
  const [, , width] = (drawing?.getAttribute("viewBox") ?? "")
    .split(/\s+/)
    .map(Number);
  const share = ((width ?? 720) - 96) / Math.max(1, groups.length);
  const widths = groups.map((group) => textWidth(group.label));
  const overlapping = groups
    .slice(1)
    .flatMap((group, index) =>
      (widths[index]! + widths[index + 1]!) / 2 > share
        ? [`“${groups[index]!.label}” and “${group.label}”`]
        : [],
    );
  if (overlapping.length)
    facts.push(
      overlapping.length === 1
        ? `1 pair of neighbouring group names overlaps: ${overlapping[0]}.`
        : `${overlapping.length} pairs of neighbouring group names overlap: ${some(overlapping)}.`,
    );
  return facts;
}

export function chartFacts(
  data: ChartData,
  drawing: SVGSVGElement | null,
): readonly string[] {
  const size = drawnSize(drawing);
  const facts =
    data.kind === "bar-chart"
      ? barFacts(data, drawing)
      : data.kind === "line-chart"
        ? lineFacts(data)
        : data.kind === "scatter-plot"
          ? scatterFacts(data)
          : data.kind === "histogram"
            ? histogramFacts(data)
            : boxFacts(data, drawing);
  return size ? [size, ...facts] : facts;
}

export function diagramFacts(
  drawing: SVGSVGElement | null,
  diagramType: string | undefined,
): readonly string[] {
  const size = drawnSize(drawing);
  return [
    ...(diagramType ? [`Mermaid drew it as a “${diagramType}” diagram.`] : []),
    ...(size ? [size] : []),
  ];
}
