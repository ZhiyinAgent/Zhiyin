import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

function isUsage(value: unknown): value is ProviderUsage {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["requestId"] === "string" &&
    typeof item["model"] === "string" &&
    typeof item["inputTokens"] === "number" &&
    typeof item["outputTokens"] === "number" &&
    typeof item["totalTokens"] === "number" &&
    (item["costUsd"] === undefined || typeof item["costUsd"] === "number") &&
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

function aggregate(
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
  };
}

export class FileUsageTelemetry implements UsageTelemetry {
  readonly #directory: string;
  #mutations: Promise<void> = Promise.resolve();
  record(usage: ProviderUsage): Promise<void> {
    const result = this.#mutations.then(() => this.#record(usage));
    this.#mutations = result.catch(() => undefined);
    return result;
  }
  readonly #file: string;

  constructor(directory: string) {
    this.#directory = directory;
    this.#file = join(directory, "usage.json");
  }

  async #record(usage: ProviderUsage): Promise<void> {
    const events = await this.#read();
    const exists = events.some((event) => event.requestId === usage.requestId);
    await this.#write(
      exists
        ? events.map((event) =>
            event.requestId === usage.requestId ? { ...usage } : event,
          )
        : [...events, { ...usage }],
    );
  }

  async state(now: Date): Promise<UsageState> {
    const events = await this.#read();
    if (events.length === 0) {
      return {
        status: "unavailable",
        reason: "Usage will appear after the first model request.",
      };
    }
    return {
      status: "ready",
      costSource: "provider-reported",
      ranges: {
        "7": aggregate(events, now, 7),
        "30": aggregate(events, now, 30),
      },
    };
  }

  async #read(): Promise<ProviderUsage[]> {
    let source: string;
    try {
      source = await readFile(this.#file, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return [];
      throw new UsageStoreError("Usage history could not be read.");
    }
    try {
      const value: unknown = JSON.parse(source);
      if (!Array.isArray(value) || !value.every(isUsage))
        throw new Error("Invalid usage history");
      return value;
    } catch {
      throw new UsageStoreError(
        "Usage history is damaged and cannot be opened safely.",
      );
    }
  }

  async #write(events: readonly ProviderUsage[]): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const temporary = `${this.#file}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(events, null, 2), "utf8");
      await rename(temporary, this.#file);
    } catch {
      throw new UsageStoreError("Usage history could not be saved.");
    }
  }
}
