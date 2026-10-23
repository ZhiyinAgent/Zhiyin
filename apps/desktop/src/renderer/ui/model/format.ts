/**
 * How prices, context windows and timings are written for someone who has
 * never chosen a model before. Units live in column headings, so these return
 * bare values — and an absent measurement reads as absent, never as zero.
 */

import { currencySymbol } from "../shared/index.js";

/** A price per million tokens, in its own currency: never converted. */
export function perMillion(amount: number, currency = "USD"): string {
  if (amount === 0) return "free";
  const symbol = currencySymbol(currency);
  // Two decimals at least, so prices line up in a column; a third below one.
  if (amount < 1) return `${symbol}${amount.toFixed(3).replace(/0$/, "")}`;
  return `${symbol}${amount.toFixed(2)}`;
}

export function tokenCount(tokens: number): string {
  if (tokens >= 1e6) return `${Math.round(tokens / 1e5) / 10}M`;
  return `${Math.round(tokens / 1000)}K`;
}

export function responseTime(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(1)} s`
    : `${Math.round(milliseconds)} ms`;
}

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const hourMs = 3_600_000;

/**
 * A lab's busy hours, stated in UTC, as they fall in the person's time zone
 * this week: with the offset of the week `now` is in, so summer and winter
 * time each read right, and on the local day each starts on.
 */
export function busyHours(
  peak: {
    readonly weekdaysUtc: readonly number[];
    readonly hoursUtc: readonly (readonly [number, number])[];
  },
  timeZone: string,
  now: Date,
): string {
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const at = (instant: number) => {
    const parts = local.formatToParts(instant);
    const part = (type: string) =>
      parts.find((each) => each.type === type)?.value ?? "";
    return {
      day: weekdays.indexOf(part("weekday")),
      time: `${part("hour")}:${part("minute")}`,
    };
  };
  const sunday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - now.getUTCDay(),
  );
  const byDay = new Map<number, string[]>();
  for (const day of peak.weekdaysUtc)
    for (const [from, to] of peak.hoursUtc) {
      const start = at(sunday + (day * 24 + from) * hourMs);
      const end = at(sunday + (day * 24 + to) * hourMs);
      byDay.set(start.day, [
        ...(byDay.get(start.day) ?? []),
        `${start.time}–${end.time}`,
      ]);
    }
  // Days that share their hours are named together, in the order of the week.
  const groups = new Map<string, number[]>();
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const hours = listed((byDay.get(day) ?? []).sort());
    groups.set(hours, [...(groups.get(hours) ?? []), day]);
  }
  return [...groups]
    .map(([hours, days]) => `${dayNames(days)}, ${hours}`)
    .join("; ");
}

/** "Monday to Friday" for a run of three or more, else each day by name. */
function dayNames(days: readonly number[]): string {
  const first = days[0] ?? 0;
  const run = days.every((day, index) => day === first + index);
  return run && days.length > 2
    ? `${weekdays[first]} to ${weekdays[first + days.length - 1]}`
    : listed(days.map((day) => weekdays[day] ?? ""));
}

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
    : (items[0] ?? "");
}

/** Where a page is, as a person reads it: its host, without "www.". */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
