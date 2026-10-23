import {
  defaultWorkPauses,
  type EstimatedCost,
  type MoneyAmount,
  type WorkBudgetRequest,
  type WorkLimit,
  type WorkPauses,
  type WorkSoFar,
} from "@zhiyin/contract";

/**
 * There is no limit on tokens. A request is counted whole, so every round of a
 * long conversation re-reads its own history, and the total grows with how much
 * has been said rather than with how much work was done. Cost and time measure
 * what a limit is for; the context window has its own guard.
 */
export type WorkLimits = {
  readonly maximumElapsedMs: number;
  /** Reported and estimated costs in dollars count toward it. */
  readonly maximumProviderCostUsd: number;
  /**
   * Limits for costs in other currencies, by ISO 4217 code. A cost is never
   * converted to meet another currency's limit, and a currency without a
   * limit never stops the work.
   */
  readonly maximumProviderCosts?: Readonly<Record<string, number>>;
  readonly maximumToolRounds?: number;
};

/** Close to the dollar limit, for work billed by a mainland China platform. */
const otherCurrencyLimits = { CNY: 70 };

/**
 * The limits a stretch of the main task is held to, as the person set them.
 * The rounds are a check-in, not a work budget: cost and time are what guard
 * against runaway work.
 */
export function workLimitsOf(pauses: WorkPauses): WorkLimits {
  return {
    maximumElapsedMs: pauses.minutes * 60 * 1_000,
    maximumProviderCostUsd: pauses.dollars,
    maximumProviderCosts: { CNY: pauses.yuan },
    maximumToolRounds: pauses.rounds,
  };
}

export const defaultWorkLimits: WorkLimits = workLimitsOf(defaultWorkPauses);

/**
 * A specialist is measured on its own, never against the main task: it cannot
 * ask anyone to go on, so it neither spends the main task's budget nor stops
 * when that runs out. It has room for real research, and is asked for a report
 * when it runs out.
 */
export const defaultSpecialistWorkLimits: WorkLimits = {
  maximumElapsedMs: 30 * 60 * 1_000,
  maximumProviderCostUsd: 10,
  maximumProviderCosts: otherCurrencyLimits,
  maximumToolRounds: 40,
};

export type WorkLimitKind = WorkLimit;

/** Where a stretch of work stands, as the work-budget question shows it. */
export type WorkCheckpoint = Pick<
  WorkBudgetRequest,
  | "completedRounds"
  | "reached"
  | "elapsedMs"
  | "costUsd"
  | "estimatedCosts"
  | "allowance"
  | "sinceStart"
>;

type Usage = {
  readonly requestId: string;
  readonly totalTokens: number;
  readonly costUsd?: number;
  readonly estimatedCost?: EstimatedCost;
};

const currencySymbols: Readonly<Record<string, string>> = {
  USD: "$",
  CNY: "¥",
};

const money = ({ amount, currency }: MoneyAmount) =>
  `${currencySymbols[currency] ?? `${currency} `}${amount.toFixed(4)}`;

/**
 * What one stretch of work has spent, renewed when the person chooses
 * Continue. A specialist keeps a ledger of its own.
 */
export class WorkLedger {
  readonly #limits: WorkLimits;
  readonly #requests = new Set<string>();
  #startedAt: number;
  #measuredTokens = 0;
  #estimatedTokens = 0;
  /** What providers reported, in dollars. */
  #providerCostUsd = 0;
  /** What price lists estimate where no cost was reported, by currency. */
  #estimatedCosts = new Map<string, number>();
  #pricedRequests = 0;
  #reportedRequests = 0;
  #unpricedRequests = 0;
  #completedToolRounds = 0;
  /** The rounds this stretch may take; each renewal doubles it. ADR 0018. */
  #toolRounds: number;
  /** What the stretches before this one used, once there were any. */
  #earlier:
    | {
        readonly startedAt: number;
        completedRounds: number;
        providerCostUsd: number;
        reported: boolean;
        readonly estimatedCosts: Map<string, number>;
      }
    | undefined;

  constructor(limits: WorkLimits, startedAt: Date) {
    this.#limits = limits;
    this.#startedAt = startedAt.getTime();
    this.#toolRounds = limits.maximumToolRounds ?? defaultWorkPauses.rounds;
  }

  record(usage: Usage): void {
    if (usage.requestId !== "unknown" && this.#requests.has(usage.requestId))
      return;
    if (usage.requestId !== "unknown") this.#requests.add(usage.requestId);
    this.#measuredTokens += Math.max(0, usage.totalTokens);
    const estimate = usage.estimatedCost;
    if (usage.costUsd !== undefined) {
      this.#pricedRequests += 1;
      this.#reportedRequests += 1;
      this.#providerCostUsd += Math.max(0, usage.costUsd);
    } else if (estimate) {
      this.#pricedRequests += 1;
      this.#estimatedCosts.set(
        estimate.currency,
        (this.#estimatedCosts.get(estimate.currency) ?? 0) +
          Math.max(0, estimate.amount),
      );
    } else this.#unpricedRequests += 1;
  }

  /** A request no provider counted, with what a price list makes of it. */
  estimate(tokens: number, cost?: EstimatedCost): void {
    this.#estimatedTokens += Math.max(0, tokens);
    if (!cost) {
      this.#unpricedRequests += 1;
      return;
    }
    this.#pricedRequests += 1;
    this.#estimatedCosts.set(
      cost.currency,
      (this.#estimatedCosts.get(cost.currency) ?? 0) + Math.max(0, cost.amount),
    );
  }

  completeToolRound(): void {
    this.#completedToolRounds += 1;
  }

  completedToolRounds(): number {
    return this.#completedToolRounds;
  }

  maximumToolRounds(): number {
    return this.#toolRounds;
  }

  reached(now: Date): readonly WorkLimitKind[] {
    const reached: WorkLimitKind[] = [];
    if (this.#completedToolRounds >= this.maximumToolRounds())
      reached.push("toolRounds");
    if (now.getTime() - this.#startedAt >= this.#limits.maximumElapsedMs)
      reached.push("elapsed");
    if (this.#costLimitReached()) reached.push("providerCost");
    return reached;
  }

  /** Each currency against its own limit; dollars reported and estimated. */
  #costLimitReached(): boolean {
    const dollars =
      this.#providerCostUsd + (this.#estimatedCosts.get("USD") ?? 0);
    if (dollars >= this.#limits.maximumProviderCostUsd) return true;
    return Object.entries(this.#limits.maximumProviderCosts ?? {}).some(
      ([currency, limit]) => (this.#estimatedCosts.get(currency) ?? 0) >= limit,
    );
  }

  #estimates(costs = this.#estimatedCosts): MoneyAmount[] {
    return [...costs]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amount]) => ({ currency, amount }));
  }

  /** The whole task, this stretch included, once there was an earlier one. */
  #sinceStart(now: Date): WorkSoFar | undefined {
    const earlier = this.#earlier;
    if (!earlier) return undefined;
    const estimated = new Map(earlier.estimatedCosts);
    for (const [currency, amount] of this.#estimatedCosts)
      estimated.set(currency, (estimated.get(currency) ?? 0) + amount);
    return {
      completedRounds: earlier.completedRounds + this.#completedToolRounds,
      elapsedMs: Math.max(0, now.getTime() - earlier.startedAt),
      ...(earlier.reported || this.#reportedRequests > 0
        ? { costUsd: earlier.providerCostUsd + this.#providerCostUsd }
        : {}),
      ...(estimated.size > 0
        ? { estimatedCosts: this.#estimates(estimated) }
        : {}),
    };
  }

  #otherLimits(): MoneyAmount[] {
    return Object.entries(this.#limits.maximumProviderCosts ?? {}).map(
      ([currency, amount]) => ({ currency, amount }),
    );
  }

  checkpoint(now: Date): WorkCheckpoint {
    const sinceStart = this.#sinceStart(now);
    return {
      completedRounds: this.#completedToolRounds,
      reached: this.reached(now),
      elapsedMs: Math.max(0, now.getTime() - this.#startedAt),
      ...(this.#reportedRequests > 0 ? { costUsd: this.#providerCostUsd } : {}),
      ...(this.#estimatedCosts.size > 0
        ? { estimatedCosts: this.#estimates() }
        : {}),
      allowance: {
        toolRounds: this.maximumToolRounds() * 2,
        elapsedMs: this.#limits.maximumElapsedMs,
        providerCostUsd: this.#limits.maximumProviderCostUsd,
        ...(this.#otherLimits().length > 0
          ? { providerCosts: this.#otherLimits() }
          : {}),
      },
      ...(sinceStart ? { sinceStart } : {}),
    };
  }

  describe(now: Date, kinds: readonly string[]): string {
    const elapsedMs = Math.max(0, now.getTime() - this.#startedAt);
    const elapsedSeconds = Math.floor(elapsedMs / 1_000);
    const tokens =
      this.#estimatedTokens === 0
        ? `${this.#measuredTokens.toLocaleString("en")} measured tokens`
        : this.#measuredTokens === 0
          ? `${this.#estimatedTokens.toLocaleString("en")} estimated tokens`
          : `${this.#measuredTokens.toLocaleString("en")} measured and ${this.#estimatedTokens.toLocaleString("en")} estimated tokens`;
    const estimated =
      this.#estimatedCosts.size > 0
        ? ` Where none was reported, estimated from price lists: ${this.#estimates().map(money).join(" and ")}.`
        : "";
    const cost =
      this.#pricedRequests > 0
        ? `Provider-reported cost is ${money({ amount: this.#providerCostUsd, currency: "USD" })}.${estimated} ${this.#unpricedRequests} request${this.#unpricedRequests === 1 ? " had" : "s had"} no known cost.`
        : "Provider cost was unavailable for these requests; the tool-round and elapsed-time limits still apply.";
    const limits = [
      money({
        amount: this.#limits.maximumProviderCostUsd,
        currency: "USD",
      }),
      ...this.#otherLimits().map(money),
    ].join(", or ");
    const labels = kinds.map((kind) =>
      kind === "providerCost"
        ? "provider-cost"
        : kind === "toolRounds"
          ? "tool-round"
          : kind,
    );
    return `The work reached its ${labels.join(" and ")} limit after ${this.#completedToolRounds} tool rounds. So far: ${tokens}; ${elapsedSeconds} seconds elapsed (limit ${Math.floor(this.#limits.maximumElapsedMs / 1_000)}); ${cost} The provider-cost limit is ${limits}.`;
  }

  /**
   * A new stretch after the person chose Continue. Time and cost start again
   * at the same limits; the rounds double, since each Continue is the person
   * choosing this work again after seeing it.
   */
  renew(now: Date): void {
    const earlier = (this.#earlier ??= {
      startedAt: this.#startedAt,
      completedRounds: 0,
      providerCostUsd: 0,
      reported: false,
      estimatedCosts: new Map(),
    });
    earlier.completedRounds += this.#completedToolRounds;
    earlier.providerCostUsd += this.#providerCostUsd;
    earlier.reported ||= this.#reportedRequests > 0;
    for (const [currency, amount] of this.#estimatedCosts)
      earlier.estimatedCosts.set(
        currency,
        (earlier.estimatedCosts.get(currency) ?? 0) + amount,
      );
    this.#toolRounds *= 2;
    this.#startedAt = now.getTime();
    this.#requests.clear();
    this.#measuredTokens = 0;
    this.#estimatedTokens = 0;
    this.#providerCostUsd = 0;
    this.#estimatedCosts = new Map();
    this.#pricedRequests = 0;
    this.#reportedRequests = 0;
    this.#unpricedRequests = 0;
    this.#completedToolRounds = 0;
  }
}

/** What the model is told when the person chose Continue. */
export function renewalNotice(ledger: WorkLedger): string {
  return [
    "The person chose Continue at the renewable work-budget boundary.",
    `A fresh budget of ${ledger.maximumToolRounds()} tool rounds is available for the same task.`,
    "Continue from where the conversation stands.",
  ].join("\n");
}
