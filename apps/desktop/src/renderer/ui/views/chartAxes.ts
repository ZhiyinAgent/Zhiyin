/**
 * The axes charts share: the span of values an axis covers, the round values
 * it is labelled at, and the x axis every series of a line chart is drawn
 * against.
 */

type X = string | number;

/**
 * The values an axis spans, from the data's own lowest to its highest with a
 * little room each side. Zero is not forced in, so data far from it fills the
 * plot; data that never crosses zero is not given an axis that does.
 */
export function dataSpan(values: readonly number[]): [number, number] {
  let low = Math.min(...values);
  let high = Math.max(...values);
  // Values the numbers can barely hold apart are taken as one.
  if (alike(low, high)) {
    const room = Math.abs(low) * 0.1 || 1;
    low -= room;
    high += room;
  }
  const room = (high - low) * 0.05;
  const from = low >= 0 ? Math.max(0, low - room) : low - room;
  const to = high <= 0 ? Math.min(0, high + room) : high + room;
  return [from, to];
}

/**
 * The values an axis labelled only at its ends spans: exactly the data's, so
 * each end is labelled with a value the data has.
 */
export function dataEnds(values: readonly number[]): [number, number] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (!alike(low, high)) return [low, high];
  const room = Math.abs(low) * 0.1 || 1;
  return [low - room, high + room];
}

/** Whether two values are too close for an axis between them to be drawn. */
function alike(low: number, high: number): boolean {
  return high - low <= Math.max(Math.abs(low), Math.abs(high)) * 1e-12;
}

/** A round step about a quarter of the span: 1, 2, 2.5 or 5 times a power of ten. */
function roundStep(span: number): number {
  const rough = span / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const multiple = rough / power;
  const round =
    multiple <= 1
      ? 1
      : multiple <= 2
        ? 2
        : multiple <= 2.5
          ? 2.5
          : multiple <= 5
            ? 5
            : 10;
  return round * power;
}

/** The round values inside a span an axis is labelled at, with their labels. */
export function roundTicks(
  domain: readonly [number, number],
): { readonly value: number; readonly label: string }[] {
  const [low, high] = domain;
  if (!(high > low)) return [];
  const step = roundStep(high - low);
  const first = Math.ceil(low / step - 1e-9);
  const last = Math.floor(high / step + 1e-9);
  // A span the numbers cannot step through evenly is labelled at its ends.
  if (!(last >= first) || last - first > 10 || low + step === low)
    return [low, high].map((value) => ({ value, label: endLabel(value) }));
  const ticks: { value: number; label: string }[] = [];
  for (let index = first; index <= last; index++) {
    // Twelve digits leave out the noise of floating point: 0.3, not 0.30000000000000004.
    const value = Number((index * step).toPrecision(12));
    ticks.push({ value, label: String(value) });
  }
  return ticks;
}

/** A number at an axis's end, given as it is rather than to three digits. */
export function endLabel(value: number): string {
  return Number(value.toPrecision(6)).toString();
}

/**
 * The x axis a line chart's series share: by value when every x is a number,
 * by time when every x is an ISO date, otherwise the x values in order. In
 * that order each series' own order is kept; values no series orders against
 * each other come in the order they were first given.
 */
export type LineAxis =
  | { readonly kind: "number"; readonly domain: [number, number] }
  | { readonly kind: "time"; readonly domain: [number, number] }
  | { readonly kind: "category"; readonly order: readonly X[] };

/** An ISO date, with or without a time of day, in its parts. */
const isoDate =
  /^(\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|([+-])(\d{2}):?(\d{2}))?)?)?$/;

/**
 * When an x given as an ISO date is, in milliseconds; none for any other, or
 * for a day or time no calendar has. A time with no zone is read on the same
 * clock as a date alone, whatever the computer's zone.
 */
export function timeOf(x: X): number | undefined {
  if (typeof x !== "string") return undefined;
  const parts = isoDate.exec(x);
  if (!parts) return undefined;
  const [year, month, day = 1, hour = 0, minute = 0, second = 0] = parts
    .slice(1, 7)
    .map((part) => (part === undefined ? undefined : Number(part)));
  const fraction = Number(parts[7] ?? 0) * 1_000;
  // Set field by field: Date.UTC reads a year under 100 as 1900 and more.
  const read = new Date(0);
  read.setUTCFullYear(year!, month! - 1, day);
  read.setUTCHours(hour!, minute, second, fraction);
  const at = read.valueOf();
  if (
    read.getUTCFullYear() !== year ||
    read.getUTCMonth() !== month! - 1 ||
    read.getUTCDate() !== day ||
    read.getUTCHours() !== hour ||
    read.getUTCMinutes() !== minute ||
    read.getUTCSeconds() !== second ||
    Number(parts[10] ?? 0) > 23 ||
    Number(parts[11] ?? 0) > 59
  )
    return undefined;
  const offset = parts[9]
    ? (parts[9] === "-" ? -1 : 1) *
      (Number(parts[10]) * 60 + Number(parts[11])) *
      60_000
    : 0;
  return at - offset;
}

export function lineAxis(
  series: readonly { readonly points: readonly { readonly x: X }[] }[],
): LineAxis {
  const xs = series.flatMap((set) => set.points.map((point) => point.x));
  if (xs.length && xs.every((x) => typeof x === "number"))
    return { kind: "number", domain: dataEnds(xs as number[]) };
  const times = xs.map(timeOf);
  if (xs.length && times.every((at) => at !== undefined))
    return { kind: "time", domain: dataEnds(times as number[]) };
  // Each series says which of its values comes before which. The values are
  // taken in that order, the earliest given first wherever it leaves a choice,
  // and where series disagree the earliest given is taken anyway.
  const key = (x: X) => String(x);
  const first = new Map<string, X>();
  for (const x of xs) if (!first.has(key(x))) first.set(key(x), x);
  const seen = [...first.keys()];
  const after = new Map(seen.map((k) => [k, new Set<string>()]));
  const waiting = new Map(seen.map((k) => [k, 0]));
  for (const set of series)
    set.points.forEach((point, index) => {
      const previous = set.points[index - 1];
      if (!previous) return;
      const from = key(previous.x);
      const to = key(point.x);
      if (from === to || after.get(from)!.has(to)) return;
      after.get(from)!.add(to);
      waiting.set(to, waiting.get(to)! + 1);
    });
  const order: X[] = [];
  const left = new Set(seen);
  while (left.size) {
    const next =
      seen.find((k) => left.has(k) && waiting.get(k) === 0) ??
      seen.find((k) => left.has(k))!;
    left.delete(next);
    order.push(first.get(next)!);
    for (const k of after.get(next)!) waiting.set(k, waiting.get(k)! - 1);
  }
  return { kind: "category", order };
}

/** The x values of a line chart's axis, in its order. */
export function axisOrder(axis: LineAxis, xs: readonly X[]): X[] {
  if (axis.kind === "category") return [...axis.order];
  const at = (x: X) => (axis.kind === "time" ? (timeOf(x) ?? 0) : Number(x));
  return [...new Set(xs)].sort((a, b) => at(a) - at(b));
}
