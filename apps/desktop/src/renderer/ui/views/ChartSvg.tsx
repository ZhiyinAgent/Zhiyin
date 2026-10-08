import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ChartData } from "./chartData.js";
import styles from "./views.module.css";

/** The width a chart is laid out at until it has been measured. */
const restingWidth = 720;
const chartHeight = 360;

/** Where the marks go, inside the room left for axes, labels and legend. */
export type Plot = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

/** The theme's chart colours, so a chart is repainted with the theme. */
export const colors = Array.from(
  { length: 8 },
  (_, index) => `var(--zy-chart-${index + 1})`,
);

/** How a series is told apart without its colour, drawn beside its name. */
export type LegendEntry = {
  readonly name: string;
  readonly colour: string;
  readonly mark: "solid" | "dashed" | "dotted" | "circle" | "diamond";
};

export const dashes = { solid: undefined, dashed: "8 5", dotted: "2 5" };

export function extent(values: number[]): [number, number] {
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 0);
  return minimum === maximum ? [minimum - 1, maximum + 1] : [minimum, maximum];
}

export function scale(
  value: number,
  domain: [number, number],
  range: [number, number],
): number {
  return (
    range[0] +
    ((value - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0])
  );
}

/** Trailing zeroes read as false precision on an axis; 40 is not 40.000. */
export function axisNumber(value: number): string {
  return Number(value.toPrecision(3)).toString();
}

/**
 * A legend entry's width, from its name. An estimate, since an SVG cannot be
 * laid out before it is drawn: generous enough that 12px names in the app's
 * font do not run into the next entry.
 */
const legendWidth = (entry: LegendEntry) => 40 + entry.name.length * 7.2;

/**
 * A hidden line of chart text, in the stylesheet's own font, that the
 * browser measures. Null where nothing can be measured (a DOM without
 * layout), and there the width is estimated instead.
 */
let ruler: SVGTextElement | null | undefined;
function rulerText(): SVGTextElement | null {
  if (ruler !== undefined) return ruler;
  ruler = null;
  if (typeof document === "undefined") return ruler;
  const namespace = "http://www.w3.org/2000/svg";
  const drawing = document.createElementNS(namespace, "svg");
  drawing.setAttribute("aria-hidden", "true");
  drawing.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
  const text = document.createElementNS(namespace, "text");
  text.setAttribute("class", styles["task-chart__tick"] ?? "");
  drawing.append(text);
  document.body.append(drawing);
  if (typeof text.getComputedTextLength !== "function") {
    drawing.remove();
    return ruler;
  }
  ruler = text;
  return ruler;
}

/** How wide a line of chart text is, as the browser draws it. */
export function textWidth(text: string): number {
  const line = rulerText();
  if (line) {
    line.textContent = text;
    const width = line.getComputedTextLength();
    if (width > 0 || !text) return width;
  }
  return estimatedWidth(text);
}

/**
 * The same, estimated like a legend entry but by kind of character, where
 * nothing is laid out.
 */
function estimatedWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    if (/[ilj.,;:'!|]/.test(character)) width += 3.4;
    else if (character === " ") width += 3.6;
    else if (/[A-Zmw@%&]/.test(character)) width += 8.6;
    else width += 6.8;
  }
  return width;
}

/** How far apart the lines of a name under the plot are. */
export const tickLineHeight = 15;

function legendRows(legend: LegendEntry[], from: number, to: number) {
  const placed: { entry: LegendEntry; x: number; row: number }[] = [];
  let x = from;
  let row = 0;
  for (const entry of legend) {
    if (x > from && x + legendWidth(entry) > to) {
      x = from;
      row += 1;
    }
    placed.push({ entry, x, row });
    x += legendWidth(entry);
  }
  return { placed, rows: legend.length ? row + 1 : 0 };
}

function LegendMark({
  entry,
  x,
  y,
}: {
  entry: LegendEntry;
  x: number;
  y: number;
}) {
  if (entry.mark === "circle")
    return <circle cx={x + 12} cy={y} r="5" style={{ fill: entry.colour }} />;
  if (entry.mark === "diamond")
    return (
      <rect
        x={x + 8}
        y={y - 4}
        width="8"
        height="8"
        transform={`rotate(45 ${x + 12} ${y})`}
        style={{ fill: entry.colour }}
      />
    );
  return (
    <line
      className={styles["task-chart__line"]}
      x1={x}
      x2={x + 24}
      y1={y}
      y2={y}
      style={{ stroke: entry.colour }}
      strokeDasharray={dashes[entry.mark]}
    />
  );
}

/**
 * Drawn at the width it is shown at, so its text is the size the stylesheet
 * says. A chart laid out at a fixed width and scaled to fit its card would
 * scale its text with it: 9px in a narrow card, 13px in a wide one.
 */
export function ChartSvg({
  data,
  yDomain,
  xEnds,
  legend = [],
  unitOn = "y",
  counts = false,
  tickLines,
  children,
}: {
  data: ChartData;
  /** The values the vertical axis spans. Without it the chart is a shape, not a claim. */
  yDomain?: [number, number];
  /** Where the horizontal axis starts and ends, for charts whose marks carry no label of their own. */
  xEnds?: [string, string];
  legend?: LegendEntry[];
  /** The axis the measured values run along, which is the one the unit names. */
  unitOn?: "x" | "y";
  /** The vertical axis counts things, so a tick between two counts says nothing. */
  counts?: boolean;
  /** Lines the names under the plot take at this plot width; the plot makes room. */
  tickLines?: (plotWidth: number) => number;
  children: (plot: Plot) => ReactNode;
}) {
  const drawing = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(restingWidth);
  useLayoutEffect(() => {
    const element = drawing.current;
    if (!element) return;
    const measure = () => {
      const shown = Math.round(element.getBoundingClientRect().width);
      if (shown > 0) setWidth(shown);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const left = 72;
  const right = width - 24;
  const key = legendRows(legend, left, right);
  const lines = tickLines?.(right - left) ?? 1;
  const plot: Plot = {
    left,
    right,
    top: key.rows ? 26 + key.rows * 22 : 24,
    bottom: 304 - tickLineHeight * (lines - 1),
  };
  const ticks = (
    yDomain ? [yDomain[0], (yDomain[0] + yDomain[1]) / 2, yDomain[1]] : []
  )
    .filter((value) => !counts || Number.isInteger(value))
    .map((value) => ({
      value,
      y: scale(value, yDomain ?? [0, 1], [plot.bottom, plot.top]) + 4,
    }));
  /** A unit is never dropped for want of a label to hang it on. */
  const named = (label: string | undefined, axis: "x" | "y") =>
    data.unit && unitOn === axis ? `${label ?? "Value"} (${data.unit})` : label;
  const xLabel = named(data.xLabel, "x");
  const yLabel = named(data.yLabel, "y");

  return (
    <svg
      ref={drawing}
      viewBox={`0 0 ${width} ${chartHeight}`}
      role="img"
      aria-label={data.title}
    >
      <title>{data.title}</title>
      {key.placed.map(({ entry, x, row }) => (
        <g key={entry.name}>
          <LegendMark entry={entry} x={x} y={14 + row * 22} />
          <text
            className={styles["task-chart__legend"]}
            x={x + 32}
            y={18 + row * 22}
          >
            {entry.name}
          </text>
        </g>
      ))}
      <line
        className={styles["task-chart__axis"]}
        x1={plot.left}
        y1={plot.top}
        x2={plot.left}
        y2={plot.bottom}
      />
      <line
        className={styles["task-chart__axis"]}
        x1={plot.left}
        y1={plot.bottom}
        x2={plot.right}
        y2={plot.bottom}
      />
      {ticks.map((tick) => (
        <text
          key={tick.value}
          className={styles["task-chart__tick"]}
          x={plot.left - 8}
          y={tick.y}
          textAnchor="end"
        >
          {axisNumber(tick.value)}
        </text>
      ))}
      {xEnds && (
        <>
          <text
            className={styles["task-chart__tick"]}
            x={plot.left}
            y={plot.bottom + 20}
            textAnchor="start"
          >
            {xEnds[0]}
          </text>
          <text
            className={styles["task-chart__tick"]}
            x={plot.right}
            y={plot.bottom + 20}
            textAnchor="end"
          >
            {xEnds[1]}
          </text>
        </>
      )}
      {children(plot)}
      {xLabel && (
        <text
          className={styles["task-chart__label"]}
          x={(plot.left + plot.right) / 2}
          y="350"
          textAnchor="middle"
        >
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text
          className={styles["task-chart__label"]}
          transform={`rotate(-90 18 ${(plot.top + plot.bottom) / 2})`}
          x="18"
          y={(plot.top + plot.bottom) / 2}
          textAnchor="middle"
        >
          {yLabel}
        </text>
      )}
    </svg>
  );
}
