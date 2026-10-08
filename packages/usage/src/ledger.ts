import { appendFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderUsage, UsageState } from "@zhiyin/contract";
import {
  UsageStoreError,
  aggregate,
  isUsage,
  type UsageTelemetry,
} from "./usage.js";

/** How many months before the current one are kept. */
const keptMonths = 13;

/** `2026-09` for any moment in September 2026, UTC. */
const monthOf = (at: Date) => at.toISOString().slice(0, 7);

const monthIndex = (month: string) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

const missing = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

/**
 * Usage kept as one file a month, one request a line. A request is appended,
 * never rewritten into the rest, so recording costs the same on the first day
 * as after a year; a line that cannot be read is skipped and the rest still
 * counts. Months past the kept span are removed as new ones are recorded.
 */
export class FileUsageTelemetry implements UsageTelemetry {
  readonly #directory: string;
  #mutations: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.#directory = join(directory, "usage");
  }

  record(usage: ProviderUsage): Promise<void> {
    const result = this.#mutations.then(() => this.#record(usage));
    this.#mutations = result.catch(() => undefined);
    return result;
  }

  async #record(usage: ProviderUsage): Promise<void> {
    const at = new Date(usage.recordedAt);
    const month = Number.isNaN(at.valueOf())
      ? monthOf(new Date())
      : monthOf(at);
    try {
      await mkdir(this.#directory, { recursive: true });
      await appendFile(
        join(this.#directory, `${month}.jsonl`),
        `${JSON.stringify(usage)}\n`,
        "utf8",
      );
    } catch {
      throw new UsageStoreError("Usage history could not be saved.");
    }
    await this.#prune(month).catch(() => undefined);
  }

  async #prune(current: string) {
    const oldest = monthIndex(current) - keptMonths;
    for (const name of await readdir(this.#directory)) {
      const month = /^(\d{4}-\d{2})\.jsonl$/.exec(name)?.[1];
      if (month && monthIndex(month) < oldest)
        await rm(join(this.#directory, name), { force: true });
    }
  }

  async state(now: Date): Promise<UsageState> {
    let names: string[];
    try {
      names = await readdir(this.#directory);
    } catch (error) {
      if (!missing(error))
        throw new UsageStoreError("Usage history could not be read.");
      names = [];
    }
    if (!names.some((name) => name.endsWith(".jsonl")))
      return {
        status: "unavailable",
        reason: "Usage will appear after the first model request.",
      };
    // The longest range is thirty days, which spans at most two months.
    const months = new Set([
      monthOf(new Date(now.valueOf() - 29 * 86_400_000)),
      monthOf(now),
    ]);
    const events = new Map<string, ProviderUsage>();
    for (const month of months)
      for (const event of await this.#read(month))
        events.set(event.requestId, event);
    return {
      status: "ready",
      costSource: "provider-reported",
      ranges: {
        "7": aggregate([...events.values()], now, 7),
        "30": aggregate([...events.values()], now, 30),
      },
    };
  }

  async #read(month: string): Promise<ProviderUsage[]> {
    let source: string;
    try {
      source = await readFile(join(this.#directory, `${month}.jsonl`), "utf8");
    } catch (error) {
      if (missing(error)) return [];
      throw new UsageStoreError("Usage history could not be read.");
    }
    const events: ProviderUsage[] = [];
    for (const line of source.split("\n")) {
      if (!line.trim()) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (isUsage(value)) events.push(value);
      } catch {
        // A line torn by a crash, or edited by hand, costs only itself.
      }
    }
    return events;
  }
}
