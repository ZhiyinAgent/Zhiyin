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
  readonly low: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly high: number;
};

export function boxSummary(values: number[]): BoxSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    low: sorted[0]!,
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    high: sorted[sorted.length - 1]!,
  };
}
