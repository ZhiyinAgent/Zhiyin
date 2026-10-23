import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import type { ProviderUsage, UsageState } from "@zhiyin/contract";
import {
  DayTotals,
  UsageStoreError,
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

const missing = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

/** Whether the file's last line has no end, as when a write was cut off. */
async function endsInsideLine(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (!size) return false;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

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
 */
export class FileUsageTelemetry implements UsageTelemetry {
  readonly #directory: string;
  #mutations: Promise<void> = Promise.resolve();
  /** Each month read so far, by request id. */
  readonly #months = new Map<string, Map<string, ProviderUsage>>();
  /** The months read so far added up by day, or nothing until a summary. */
  #days: Map<string, DayTotals> | undefined;

  constructor(directory: string) {
    this.#directory = join(directory, "usage");
  }

  record(usage: ProviderUsage): Promise<void> {
    return this.#inTurn(() => this.#record(accountingOf(usage)));
  }

  /**
   * Reading waits for the writes before it, so a month it reads cannot miss a
   * request recorded while it read.
   */
  state(now: Date): Promise<UsageState> {
    return this.#inTurn(() => this.#state(now));
  }

  #inTurn<Result>(step: () => Promise<Result>): Promise<Result> {
    const result = this.#mutations.then(step);
    this.#mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #record(usage: ProviderUsage): Promise<void> {
    const at = new Date(usage.recordedAt);
    const month = Number.isNaN(at.valueOf())
      ? monthOf(new Date())
      : monthOf(at);
    try {
      await mkdir(this.#directory, { recursive: true });
      const file = join(this.#directory, `${month}.jsonl`);
      // A line a crash cut off is ended first, so this one starts its own.
      const after = (await endsInsideLine(file)) ? "\n" : "";
      await appendFile(file, `${after}${JSON.stringify(usage)}\n`, "utf8");
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
      const day = dayOf(stored);
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
    // The longest range is thirty days, which spans at most two months.
    const months = new Set([
      monthOf(new Date(now.valueOf() - 29 * 86_400_000)),
      monthOf(now),
    ]);
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
      this.#days = totalsByDay(events.values());
    }
    return {
      status: "ready",
      ranges: {
        "7": summarize(this.#days, now, 7),
        "30": summarize(this.#days, now, 30),
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
