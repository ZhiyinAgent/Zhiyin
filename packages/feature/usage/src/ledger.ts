import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderUsage, UsageState } from "@zhiyin/contract";
import { appendLine } from "@zhiyin/files";
import { Serial } from "@zhiyin/one-at-a-time";
import {
  DayTotals,
  UsageStoreError,
  computerTimeZone,
  dayOf,
  isUsage,
  summarize,
  totalsByDay,
  type UsageTelemetry,
} from "./usage.js";

/** How many months before the current one are kept. */
const keptMonths = 13;

/** `2026-09` for any moment in September 2026, UTC. */
const monthOf = (at: Date) => at.toISOString().slice(0, 7);

const monthIndex = (month: string) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/** The month `monthIndex` gave this number. */
const monthName = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

const missing = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

/** A request's accounting alone, whatever else the record carries. */
function accountingOf(usage: ProviderUsage): ProviderUsage {
  const optional = <Key extends keyof ProviderUsage>(key: Key) =>
    usage[key] === undefined ? {} : { [key]: usage[key] };
  return {
    requestId: usage.requestId,
    model: usage.model,
    ...optional("provider"),
    ...optional("conversationId"),
    ...optional("purpose"),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    ...optional("costUsd"),
    ...(usage.estimatedCost
      ? {
          estimatedCost: {
            amount: usage.estimatedCost.amount,
            currency: usage.estimatedCost.currency,
            priceList: usage.estimatedCost.priceList,
          },
        }
      : {}),
    ...optional("cacheReadTokens"),
    ...optional("cacheWriteTokens"),
    ...optional("reasoningTokens"),
    recordedAt: usage.recordedAt,
  };
}

/**
 * Usage kept as one file a month, one request a line. A request is appended,
 * never rewritten into the rest, so recording costs the same on the first day
 * as after a year; a line that cannot be read is skipped and the rest still
 * counts, and one a crash cut off is ended before the next is written. Months
 * past the kept span are removed as new ones are recorded.
 *
 * The months a summary spans are read once and kept, each new request added
 * to them as it is recorded, so a summary does not read the history again.
 * Each day's requests are kept added up too, a new request added to its day,
 * so a summary adds up thirty days, not every request in them. Only one
 * Zhiyin writes these files at a time.
 *
 * Days are calendar days in the computer's own time zone, unless another is
 * given, so a request falls on the day its person made it. Files stay one per
 * UTC month.
 */
export class FileUsageTelemetry implements UsageTelemetry {
  readonly #directory: string;
  readonly #timeZone: string;
  readonly #mutations = new Serial();
  /** Each month read so far, by request id. */
  readonly #months = new Map<string, Map<string, ProviderUsage>>();
  /** The months read so far added up by day, or nothing until a summary. */
  #days: Map<string, DayTotals> | undefined;

  constructor(directory: string, options: { readonly timeZone?: string } = {}) {
    this.#directory = join(directory, "usage");
    this.#timeZone = options.timeZone ?? computerTimeZone();
  }

  record(usage: ProviderUsage): Promise<void> {
    return this.#mutations.run(() => this.#record(accountingOf(usage)));
  }

  /**
   * Reading waits for the writes before it, so a month it reads cannot miss a
   * request recorded while it read.
   */
  state(now: Date): Promise<UsageState> {
    return this.#mutations.run(() => this.#state(now));
  }

  async #record(usage: ProviderUsage): Promise<void> {
    const at = new Date(usage.recordedAt);
    const month = Number.isNaN(at.valueOf())
      ? monthOf(new Date())
      : monthOf(at);
    try {
      await mkdir(this.#directory, { recursive: true });
      await appendLine(
        join(this.#directory, `${month}.jsonl`),
        JSON.stringify(usage),
      );
    } catch {
      throw new UsageStoreError("Usage history could not be saved.");
    }
    // Kept as reading the line back would give it: one that would be skipped
    // then is skipped now.
    const stored: unknown = JSON.parse(JSON.stringify(usage));
    const read = this.#months.get(month);
    if (isUsage(stored) && read) {
      // A request recorded again counts as last recorded: the days are added
      // up again. Otherwise it is added to its day.
      const again = [...this.#months.values()].some((requests) =>
        requests.has(stored.requestId),
      );
      read.set(stored.requestId, stored);
      const day = dayOf(stored, this.#timeZone);
      if (again) this.#days = undefined;
      else if (day && this.#days) {
        let totals = this.#days.get(day);
        if (!totals) {
          totals = new DayTotals();
          this.#days.set(day, totals);
        }
        totals.add(stored);
      }
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

  async #state(now: Date): Promise<UsageState> {
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
    // Every month the longest range touches: thirty days in any time zone
    // start less than thirty-one days ago, and February can lie wholly
    // between their first month and their last.
    const months = new Set<string>();
    for (
      let index = monthIndex(
        monthOf(new Date(now.valueOf() - 31 * 86_400_000)),
      );
      index <= monthIndex(monthOf(now));
      index += 1
    )
      months.add(monthName(index));
    // A month left behind is let go, and the days are added up again: a
    // request it held too then sits where the later month has it.
    for (const month of this.#months.keys())
      if (!months.has(month)) {
        this.#months.delete(month);
        this.#days = undefined;
      }
    for (const month of months) {
      if (this.#months.has(month)) continue;
      const read = new Map<string, ProviderUsage>();
      for (const event of await this.#read(month))
        read.set(event.requestId, event);
      this.#months.set(month, read);
      this.#days = undefined;
    }
    if (!this.#days) {
      const events = new Map<string, ProviderUsage>();
      for (const month of months)
        for (const [requestId, event] of this.#months.get(month)!)
          events.set(requestId, event);
      this.#days = totalsByDay(events.values(), this.#timeZone);
    }
    return {
      status: "ready",
      ranges: {
        "7": summarize(this.#days, now, 7, this.#timeZone),
        "30": summarize(this.#days, now, 30, this.#timeZone),
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
