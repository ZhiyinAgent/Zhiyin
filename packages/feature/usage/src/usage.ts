import type {
  EstimatedCost,
  MoneyAmount,
  ProviderUsage,
  UsageRange,
  UsageState,
} from "@zhiyin/contract";

export interface UsageTelemetry {
  record(usage: ProviderUsage): Promise<void>;
  state(now: Date): Promise<UsageState>;
}

export class UsageStoreError extends Error {
  readonly code: "unavailable";

  constructor(message: string) {
    super(message);
    this.name = "UsageStoreError";
    this.code = "unavailable";
  }
}

const purposes: readonly unknown[] = [
  "turn",
  "condensing",
  "specialist",
  "background",
];

const optional = (value: unknown, type: "string" | "number") =>
  value === undefined || typeof value === type;

function isEstimate(value: unknown): value is EstimatedCost {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["amount"] === "number" &&
    Number.isFinite(item["amount"]) &&
    item["amount"] >= 0 &&
    typeof item["currency"] === "string" &&
    typeof item["priceList"] === "string"
  );
}

export function isUsage(value: unknown): value is ProviderUsage {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["requestId"] === "string" &&
    typeof item["model"] === "string" &&
    typeof item["inputTokens"] === "number" &&
    typeof item["outputTokens"] === "number" &&
    typeof item["totalTokens"] === "number" &&
    optional(item["costUsd"], "number") &&
    (item["estimatedCost"] === undefined ||
      isEstimate(item["estimatedCost"])) &&
    optional(item["cacheReadTokens"], "number") &&
    optional(item["cacheWriteTokens"], "number") &&
    optional(item["reasoningTokens"], "number") &&
    optional(item["provider"], "string") &&
    optional(item["conversationId"], "string") &&
    (item["purpose"] === undefined || purposes.includes(item["purpose"])) &&
    typeof item["recordedAt"] === "string"
  );
}

/** The computer's own time zone, which its person's days are counted in. */
export function computerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const calendars = new Map<string, Intl.DateTimeFormat>();

/** `2026-09-14`: the calendar day a moment falls on in a time zone. */
function calendarDay(at: Date, timeZone: string): string {
  let calendar = calendars.get(timeZone);
  if (!calendar) {
    calendar = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    calendars.set(timeZone, calendar);
  }
  const parts = calendar.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The calendar day `days` after `date`, both written `2026-09-14`. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function roundedCost(value: number) {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

/** Estimated costs added up in each currency apart, never converted. */
class Estimates {
  readonly #amounts = new Map<string, number>();

  add(cost: EstimatedCost | undefined): void {
    if (cost)
      this.#amounts.set(
        cost.currency,
        (this.#amounts.get(cost.currency) ?? 0) + cost.amount,
      );
  }

  /** Another set of estimates added to these. */
  addAll(other: Estimates): void {
    for (const [currency, amount] of other.#amounts)
      this.#amounts.set(currency, (this.#amounts.get(currency) ?? 0) + amount);
  }

  in(currency: string): number {
    return this.#amounts.get(currency) ?? 0;
  }

  currencies(): string[] {
    return [...this.#amounts.keys()];
  }

  /** The summary's field, left out when nothing was estimated. */
  field(): { estimatedCosts?: readonly MoneyAmount[] } {
    if (this.#amounts.size === 0) return {};
    return {
      estimatedCosts: [...this.#amounts]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => ({
          currency,
          amount: roundedCost(amount),
        })),
    };
  }
}

const priced = (event: ProviderUsage) =>
  event.costUsd !== undefined || event.estimatedCost !== undefined;

/** What a set of requests spent, in every way the usage page counts it. */
type Spent = {
  requests: number;
  pricedRequests: number;
  costUsd: number;
  estimates: Estimates;
};

const spentNothing = (): Spent => ({
  requests: 0,
  pricedRequests: 0,
  costUsd: 0,
  estimates: new Estimates(),
});

function spend(spent: Spent, event: ProviderUsage): void {
  spent.requests += 1;
  if (priced(event)) spent.pricedRequests += 1;
  spent.costUsd += event.costUsd ?? 0;
  spent.estimates.add(event.estimatedCost);
}

function addSpent(into: Spent, from: Spent): void {
  into.requests += from.requests;
  into.pricedRequests += from.pricedRequests;
  into.costUsd += from.costUsd;
  into.estimates.addAll(from.estimates);
}

type ModelSpent = Spent & { inputTokens: number; outputTokens: number };

/**
 * One day's requests added up, kept as each is recorded, so a summary adds
 * up at most thirty days rather than every request in them.
 */
export class DayTotals {
  readonly all: ModelSpent = {
    ...spentNothing(),
    inputTokens: 0,
    outputTokens: 0,
  };
  readonly models = new Map<string, ModelSpent>();
  readonly conversations = new Map<string | undefined, Spent>();

  add(event: ProviderUsage): void {
    for (const spent of [
      this.all,
      lookup(this.models, event.model, () => ({
        ...spentNothing(),
        inputTokens: 0,
        outputTokens: 0,
      })),
    ]) {
      spend(spent, event);
      spent.inputTokens += event.inputTokens;
      spent.outputTokens += event.outputTokens;
    }
    spend(
      lookup(this.conversations, event.conversationId, spentNothing),
      event,
    );
  }
}

function lookup<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  made: () => Value,
): Value {
  let value = map.get(key);
  if (!value) {
    value = made();
    map.set(key, value);
  }
  return value;
}

/**
 * The day a request was recorded on in a time zone, or nothing when its time
 * is not one.
 */
export function dayOf(
  event: ProviderUsage,
  timeZone: string,
): string | undefined {
  const recordedAt = new Date(event.recordedAt);
  return Number.isNaN(recordedAt.valueOf())
    ? undefined
    : calendarDay(recordedAt, timeZone);
}

/** Requests added up by the day each was recorded on in a time zone. */
export function totalsByDay(
  events: Iterable<ProviderUsage>,
  timeZone: string,
): Map<string, DayTotals> {
  const days = new Map<string, DayTotals>();
  for (const event of events) {
    const day = dayOf(event, timeZone);
    if (day) lookup(days, day, () => new DayTotals()).add(event);
  }
  return days;
}

/** The last `days` days up to `now` in a time zone, from each day's totals. */
export function summarize(
  totals: ReadonlyMap<string, DayTotals>,
  now: Date,
  days: 7 | 30,
  timeZone: string,
): UsageRange {
  const start = addDays(calendarDay(now, timeZone), -(days - 1));
  const all: ModelSpent = {
    ...spentNothing(),
    inputTokens: 0,
    outputTokens: 0,
  };
  const models = new Map<string, ModelSpent>();
  const conversations = new Map<string | undefined, Spent>();
  const activity = Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index);
    const day = totals.get(date);
    if (day) {
      addSpent(all, day.all);
      all.inputTokens += day.all.inputTokens;
      all.outputTokens += day.all.outputTokens;
      for (const [model, spent] of day.models) {
        const sum = lookup(models, model, () => ({
          ...spentNothing(),
          inputTokens: 0,
          outputTokens: 0,
        }));
        addSpent(sum, spent);
        sum.inputTokens += spent.inputTokens;
        sum.outputTokens += spent.outputTokens;
      }
      for (const [conversation, spent] of day.conversations)
        addSpent(lookup(conversations, conversation, spentNothing), spent);
    }
    return {
      date,
      requests: day?.all.requests ?? 0,
      costUsd: roundedCost(day?.all.costUsd ?? 0),
      ...(day ? day.all.estimates.field() : {}),
    };
  });

  /*
   * Costliest first: by dollars, reported or estimated, then by each other
   * currency in turn. A cost is never converted to compare it with another.
   */
  const others = all.estimates
    .currencies()
    .filter((currency) => currency !== "USD")
    .sort();
  const dollars = (spent: Spent) => spent.costUsd + spent.estimates.in("USD");
  const costliestFirst = (left: Spent, right: Spent) =>
    dollars(right) - dollars(left) ||
    others.reduce(
      (order, currency) =>
        order || right.estimates.in(currency) - left.estimates.in(currency),
      0,
    ) ||
    right.requests - left.requests;

  return {
    days,
    requests: all.requests,
    inputTokens: all.inputTokens,
    outputTokens: all.outputTokens,
    costUsd: roundedCost(all.costUsd),
    pricedRequests: all.pricedRequests,
    ...all.estimates.field(),
    activity,
    models: [...models]
      .sort(([, left], [, right]) => right.requests - left.requests)
      .map(([model, { estimates: spent, ...counted }]) => ({
        model,
        requests: counted.requests,
        pricedRequests: counted.pricedRequests,
        inputTokens: counted.inputTokens,
        outputTokens: counted.outputTokens,
        costUsd: roundedCost(counted.costUsd),
        ...spent.field(),
      })),
    conversations: [...conversations]
      .sort(([, left], [, right]) => costliestFirst(left, right))
      .map(([conversationId, { estimates: spent, ...counted }]) => ({
        ...(conversationId === undefined ? {} : { conversationId }),
        requests: counted.requests,
        pricedRequests: counted.pricedRequests,
        costUsd: roundedCost(counted.costUsd),
        ...spent.field(),
      })),
  };
}
