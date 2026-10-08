import type { ProviderUsage, UsageRange, UsageState } from "@zhiyin/contract";

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
  }));
  const activityByDate = new Map(activity.map((point) => [point.date, point]));
  const models = new Map<
    string,
    {
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    }
  >();
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let pricedRequests = 0;
  const conversations = new Map<
    string | undefined,
    { requests: number; pricedRequests: number; costUsd: number }
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
      pricedRequests += 1;
    }

    const model = models.get(event.model) ?? {
      model: event.model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    model.requests += 1;
    model.inputTokens += event.inputTokens;
    model.outputTokens += event.outputTokens;
    model.costUsd += event.costUsd ?? 0;
    models.set(event.model, model);

    const conversation = conversations.get(event.conversationId) ?? {
      requests: 0,
      pricedRequests: 0,
      costUsd: 0,
    };
    conversation.requests += 1;
    if (event.costUsd !== undefined) {
      conversation.pricedRequests += 1;
      conversation.costUsd += event.costUsd;
    }
    conversations.set(event.conversationId, conversation);
  }

  return {
    days,
    requests,
    inputTokens,
    outputTokens,
    costUsd: roundedCost(costUsd),
    pricedRequests,
    activity: activity.map((point) => ({
      ...point,
      costUsd: roundedCost(point.costUsd),
    })),
    models: [...models.values()]
      .sort((left, right) => right.requests - left.requests)
      .map((model) => ({ ...model, costUsd: roundedCost(model.costUsd) })),
    conversations: [...conversations]
      .map(([conversationId, spent]) => ({
        ...(conversationId === undefined ? {} : { conversationId }),
        ...spent,
        costUsd: roundedCost(spent.costUsd),
      }))
      .sort(
        (left, right) =>
          right.costUsd - left.costUsd || right.requests - left.requests,
      ),
  };
}
