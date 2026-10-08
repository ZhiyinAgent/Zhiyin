import type { WorkBudgetRequest, WorkLimit } from "@zhiyin/contract";

/**
 * There is no limit on tokens. A request is counted whole, so every round of a
 * long conversation re-reads its own history, and the total grows with how much
 * has been said rather than with how much work was done. Cost and time measure
 * what a limit is for; the context window has its own guard.
 */
export type WorkLimits = {
  readonly maximumElapsedMs: number;
  readonly maximumProviderCostUsd: number;
  readonly maximumToolRounds?: number;
};

export const defaultWorkLimits: WorkLimits = {
  maximumElapsedMs: 30 * 60 * 1_000,
  maximumProviderCostUsd: 10,
  // A runaway guard, not a work budget: it leaves room for ordinary analysis
  // (look around, read, run, write, chart) to finish.
  maximumToolRounds: 24,
};

/**
 * A specialist is measured on its own, never against the main task: it cannot
 * ask anyone to go on, so it neither spends the main task's budget nor stops
 * when that runs out. It has room for real research, and is asked for a report
 * when it runs out.
 */
export const defaultSpecialistWorkLimits: WorkLimits = {
  maximumElapsedMs: 30 * 60 * 1_000,
  maximumProviderCostUsd: 10,
  maximumToolRounds: 40,
};

export type WorkLimitKind = WorkLimit;

/** Where a stretch of work stands, as the work-budget question shows it. */
export type WorkCheckpoint = Pick<
  WorkBudgetRequest,
  "completedRounds" | "reached" | "elapsedMs" | "costUsd" | "allowance"
>;

type Usage = {
  readonly requestId: string;
  readonly totalTokens: number;
  readonly costUsd?: number;
};

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
  #providerCostUsd = 0;
  #pricedRequests = 0;
  #unpricedRequests = 0;
  #completedToolRounds = 0;
  /** The rounds this stretch may take; each renewal doubles it. ADR 0013. */
  #toolRounds: number;

  constructor(limits: WorkLimits, startedAt: Date) {
    this.#limits = limits;
    this.#startedAt = startedAt.getTime();
    this.#toolRounds = limits.maximumToolRounds ?? 24;
  }

  record(usage: Usage): void {
    if (usage.requestId !== "unknown" && this.#requests.has(usage.requestId))
      return;
    if (usage.requestId !== "unknown") this.#requests.add(usage.requestId);
    this.#measuredTokens += Math.max(0, usage.totalTokens);
    if (usage.costUsd === undefined) this.#unpricedRequests += 1;
    else {
      this.#pricedRequests += 1;
      this.#providerCostUsd += Math.max(0, usage.costUsd);
    }
  }

  estimate(tokens: number): void {
    this.#estimatedTokens += Math.max(0, tokens);
    this.#unpricedRequests += 1;
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
    if (this.#providerCostUsd >= this.#limits.maximumProviderCostUsd)
      reached.push("providerCost");
    return reached;
  }

  checkpoint(now: Date): WorkCheckpoint {
    return {
      completedRounds: this.#completedToolRounds,
      reached: this.reached(now),
      elapsedMs: Math.max(0, now.getTime() - this.#startedAt),
      ...(this.#pricedRequests > 0 ? { costUsd: this.#providerCostUsd } : {}),
      allowance: {
        toolRounds: this.maximumToolRounds() * 2,
        elapsedMs: this.#limits.maximumElapsedMs,
        providerCostUsd: this.#limits.maximumProviderCostUsd,
      },
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
    const cost =
      this.#pricedRequests > 0
        ? `Provider-reported cost is $${this.#providerCostUsd.toFixed(4)}; ${this.#unpricedRequests} request${this.#unpricedRequests === 1 ? " had" : "s had"} no reported cost.`
        : "Provider cost was unavailable for these requests; the tool-round and elapsed-time limits still apply.";
    const labels = kinds.map((kind) =>
      kind === "providerCost"
        ? "provider-cost"
        : kind === "toolRounds"
          ? "tool-round"
          : kind,
    );
    return `The task reached its ${labels.join(" and ")} limit after ${this.#completedToolRounds} tool rounds. So far: ${tokens}; ${elapsedSeconds} seconds elapsed (limit ${Math.floor(this.#limits.maximumElapsedMs / 1_000)}); ${cost} The provider-cost limit is $${this.#limits.maximumProviderCostUsd.toFixed(4)}. Continue with renewed reached limits, or pause after a progress report.`;
  }

  /**
   * A new stretch after the person chose Continue. Time and cost start again
   * at the same limits; the rounds double, since each Continue is the person
   * choosing this work again after seeing it.
   */
  renew(now: Date): void {
    this.#toolRounds *= 2;
    this.#startedAt = now.getTime();
    this.#requests.clear();
    this.#measuredTokens = 0;
    this.#estimatedTokens = 0;
    this.#providerCostUsd = 0;
    this.#pricedRequests = 0;
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
