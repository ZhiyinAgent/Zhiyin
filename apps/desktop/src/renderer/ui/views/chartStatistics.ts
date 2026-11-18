import type { ChartData } from "./chartData.js";

/**
 * What a chart shows of its data, worked out once. The drawing and the Data
 * table both read these, so the bars a person sees and the rows they check
 * them against cannot disagree.
 */

export type Bin = {
  readonly start: number;
  readonly end: number;
  count: number;
};

export function histogramBins(data: ChartData): Bin[] {
  const values = data.values ?? [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const count =
    data.bins ?? Math.min(20, Math.max(1, Math.ceil(Math.sqrt(values.length))));
  const width = maximum === minimum ? 1 : (maximum - minimum) / count;
  const bins: Bin[] = Array.from({ length: count }, (_, index) => ({
    start: minimum + index * width,
    end: minimum + (index + 1) * width,
    count: 0,
  }));
  values.forEach((value) => {
    const index =
      maximum === minimum
        ? 0
        : Math.min(count - 1, Math.floor((value - minimum) / width));
    if (bins[index]) bins[index].count += 1;
  });
  return bins;
}

function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return (
    sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
  );
}

export type BoxSummary = {
  /** Where the whiskers end. */
  readonly low: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly high: number;
  /** The values beyond the whiskers, smallest first. */
  readonly outliers: readonly number[];
};

/**
 * A group's box: its quartiles, and whiskers that reach the furthest values
 * within 1.5 times the box's height of it (Tukey's rule), the rest outliers;
 * or, for `range`, the group's minimum and maximum.
 */
export function boxSummary(
  values: number[],
  whiskers: ChartData["whiskers"] = "tukey",
): BoxSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const reach = whiskers === "range" ? Infinity : 1.5 * (q3 - q1);
  const within = sorted.filter(
    (value) => value >= q1 - reach && value <= q3 + reach,
  );
  return {
    low: within[0]!,
    q1,
    median: quantile(sorted, 0.5),
    q3,
    high: within[within.length - 1]!,
    outliers: sorted.filter((value) => !within.includes(value)),
  };
}
