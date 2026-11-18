/**
 * Sizes as ranges in millimetres: a number the measure must be, within what
 * the studio can measure, or [least, most].
 */

export type Range = number | readonly [number, number];

/**
 * How far a measure lies inside a range, or, below zero, past it. A single
 * number holds within `tolerance`, the studio's measuring precision.
 */
export function rangeMargin(
  measured: number,
  range: Range,
  tolerance: number,
): number {
  if (typeof range === "number") return tolerance - Math.abs(measured - range);
  return Math.min(measured - range[0], range[1] - measured);
}

/**
 * A measure as an answer writes it: to two places, and to three figures below
 * one, so a small one never reads as 0.
 */
export function figures(value: number): number {
  if (Math.abs(value) < 1e-6) return 0;
  return Math.abs(value) < 1
    ? Number(value.toPrecision(3))
    : Number(value.toFixed(2));
}

/** A range as an answer says it: "95 mm" or "80 to 85 mm". */
export function rangeWords(range: Range, unit = "mm"): string {
  const said = (value: number) => `${figures(value)}`;
  return typeof range === "number"
    ? `${said(range)} ${unit}`
    : `${said(range[0])} to ${said(range[1])} ${unit}`;
}
