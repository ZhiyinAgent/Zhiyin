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

function utcDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number) {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate() + days,
    ),
  );
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

export function aggregate(
  events: readonly ProviderUsage[],
  now: Date,
  days: 7 | 30,
): UsageRange {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = addUtcDays(end, -(days - 1));
  const activity = Array.from({ length: days }, (_, index) => ({
    date: utcDay(addUtcDays(start, index)),
    requests: 0,
    costUsd: 0,
    estimates: new Estimates(),
  }));
  const activityByDate = new Map(activity.map((point) => [point.date, point]));
  const models = new Map<
    string,
    {
      model: string;
      requests: number;
      pricedRequests: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      estimates: Estimates;
    }
  >();
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let pricedRequests = 0;
  const estimates = new Estimates();
  const conversations = new Map<
    string | undefined,
    {
      requests: number;
      pricedRequests: number;
      costUsd: number;
      estimates: Estimates;
    }
  >();

  for (const event of events) {
    const recordedAt = new Date(event.recordedAt);
    if (Number.isNaN(recordedAt.valueOf())) continue;
    const date = utcDay(recordedAt);
    const day = activityByDate.get(date);
    if (!day) continue;

    requests += 1;
    inputTokens += event.inputTokens;
    outputTokens += event.outputTokens;
    day.requests += 1;
    if (event.costUsd !== undefined) {
      costUsd += event.costUsd;
      day.costUsd += event.costUsd;
    }
    if (priced(event)) pricedRequests += 1;
    estimates.add(event.estimatedCost);
    day.estimates.add(event.estimatedCost);

    const model = models.get(event.model) ?? {
      model: event.model,
      requests: 0,
      pricedRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      estimates: new Estimates(),
    };
    model.requests += 1;
    if (priced(event)) model.pricedRequests += 1;
    model.inputTokens += event.inputTokens;
    model.outputTokens += event.outputTokens;
    model.costUsd += event.costUsd ?? 0;
    model.estimates.add(event.estimatedCost);
    models.set(event.model, model);

    const conversation = conversations.get(event.conversationId) ?? {
      requests: 0,
      pricedRequests: 0,
      costUsd: 0,
      estimates: new Estimates(),
    };
    conversation.requests += 1;
    if (priced(event)) conversation.pricedRequests += 1;
    conversation.costUsd += event.costUsd ?? 0;
    conversation.estimates.add(event.estimatedCost);
    conversations.set(event.conversationId, conversation);
  }

  /*
   * Costliest first: by dollars, reported or estimated, then by each other
   * currency in turn. A cost is never converted to compare it with another.
   */
  const others = estimates
    .currencies()
    .filter((currency) => currency !== "USD")
    .sort();
  type Spent = { costUsd: number; estimates: Estimates; requests: number };
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
    requests,
    inputTokens,
    outputTokens,
    costUsd: roundedCost(costUsd),
    pricedRequests,
    ...estimates.field(),
    activity: activity.map(({ estimates: spent, ...point }) => ({
      ...point,
      costUsd: roundedCost(point.costUsd),
      ...spent.field(),
    })),
    models: [...models.values()]
      .sort((left, right) => right.requests - left.requests)
      .map(({ estimates: spent, ...model }) => ({
        ...model,
        costUsd: roundedCost(model.costUsd),
        ...spent.field(),
      })),
    conversations: [...conversations]
      .sort(([, left], [, right]) => costliestFirst(left, right))
      .map(([conversationId, { estimates: spent, ...counted }]) => ({
        ...(conversationId === undefined ? {} : { conversationId }),
        ...counted,
        costUsd: roundedCost(counted.costUsd),
        ...spent.field(),
      })),
  };
}
