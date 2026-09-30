/**
 * What is checked before every model call, in the middle of a long run of tool
 * calls as much as at the start of a turn: whether older tool results have
 * piled up enough to clear, and whether the request has outgrown the budget
 * the person chose and must be condensed.
 *
 * Both change what was already sent, so the provider's cached copy of
 * everything after the first change is lost. Each runs only on its own
 * trigger, and each makes one large change rather than many small ones:
 *
 * - Clearing is triggered by how much of the request is tool results, not by
 *   the budget. It starts once they reach 40 % of the target and only when it
 *   frees at least 20 %, clearing at once every result older than the last 5
 *   complete rounds. A cleared result is saved and replaced by a note saying
 *   how to read it again, and is never rewritten after that.
 * - Condensing is triggered by the budget, and clearing is never stretched to
 *   avoid it.
 */

import {
  contextTarget,
  estimatedTokens,
  type ContextUsage,
  type TaskCondensing,
  type ToolSpec,
} from "@zhiyin/contract";
import type {
  ModelMessage,
  ModelTool,
  ModelUsage,
  TokenLimitDetail,
} from "@zhiyin/model-client";
import { estimatedRequestTokens } from "./conversation-context.js";
import { Condensing, type CondensingOutcome } from "./condensing.js";
import type { ModelHistory } from "./model-history.js";
import { harnessNotice } from "../turn/notices.js";
import { RequestSize } from "./request-size.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { AgentLoopDependencies } from "../dependencies.js";

const clearFrom = 0.4;
const leastCleared = 0.2;
export const protectedRounds = 5;
/**
 * Of a refused request's size, what is planned with when the provider did not
 * say its limit: it refused that size, so its limit is below it.
 */
const belowRefused = 0.9;
/** A condensing that failed is tried again once the request has grown this much. */
const regrowth = 1.1;
/** The smallest window Zhiyin is built for, assumed when a model's is unknown. */
const assumedWindow = 128_000;
const replyReserve = 16_000;
/**
 * Kept free of a condensing request beyond its reply: half the budget's own
 * margin, for the error in the estimate of what was added since the last count.
 */
const condensingMargin = 0.025;

export function clearedReceipt(id: string): string {
  return harnessNotice(
    "cleared",
    `Result saved; read it again with read_file output://${id}`,
  );
}

const clearedMark = harnessNotice("cleared", "").replace(
  /<\/zhiyin-notice>$/,
  "",
);

export type RequestPlan = {
  readonly fixed: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
};

export class ContextGuard {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  readonly #condensing: Condensing;
  readonly #size = new RequestSize();
  /** Conversations the person asked to condense before their next request. */
  readonly #asked = new Set<string>();
  /** Conversations whose next condensing follows a refusal as too long. */
  readonly #refused = new Set<string>();
  /** How many history messages each conversation's last request sent. */
  readonly #sent = new Map<string, number>();

  constructor(deps: AgentLoopDependencies, records: TurnRecords) {
    this.#deps = deps;
    this.#records = records;
    this.#condensing = new Condensing(deps, records);
  }

  /** The size the conversation's requests are kept under. */
  targetTokens(taskId: string): number {
    const task = this.#records.task(taskId);
    return contextTarget(
      task.contextBudget ?? this.#deps.host.defaultContextBudget(),
      this.#deps.host.modelWindow(),
    ).targetTokens;
  }

  /** Condenses before the conversation's next request, whatever its size. */
  ask(taskId: string): void {
    this.#asked.add(taskId);
  }

  /**
   * The provider refused the last request as too long. The window is lowered
   * to the limit it stated, else to nine tenths of what it said was sent, else
   * of what was estimated; the conversation is then condensed to a target
   * within that before the request is sent again.
   */
  refused(taskId: string, said: TokenLimitDetail): void {
    const refusedTokens =
      said.sent ?? this.#records.task(taskId).contextUsage?.totalTokens;
    const window =
      said.limit ??
      (refusedTokens ? Math.floor(refusedTokens * belowRefused) : undefined);
    if (window && refusedTokens)
      this.#deps.host.lowerWindow(window, refusedTokens);
    this.#asked.add(taskId);
    this.#refused.add(taskId);
  }

  /**
   * The history to send next: older results cleared when they have piled up,
   * and condensed when the request is past its budget or the person asked.
   */
  async prepare(
    taskId: string,
    history: ModelHistory,
    plan: RequestPlan,
    reopen: () => Promise<ModelHistory>,
    signal: AbortSignal,
  ): Promise<ModelHistory> {
    const target = this.targetTokens(taskId);
    await this.#clearOlderResults(taskId, history, target);
    const size = (messages: readonly ModelMessage[]) =>
      this.#size.of(taskId, this.#parts(plan, messages)).tokens;
    const before = size(history.messages());
    const waitFor = this.#waitingToGrow(taskId, target);
    const asked = this.#asked.delete(taskId);
    const afterRefusal = this.#refused.delete(taskId);
    if (
      asked ||
      (before > target && !(waitFor && before < waitFor * regrowth))
    ) {
      const model = this.#deps.host.modelWindow();
      const window = model.contextWindow ?? assumedWindow;
      const reply = Math.min(
        model.maximumOutputTokens ?? replyReserve,
        replyReserve,
      );
      const outcome = await this.#condensing.condense({
        taskId,
        history,
        fixed: plan.fixed,
        tools: plan.tools,
        targetTokens: target,
        roomTokens: Math.floor(window - reply - window * condensingMargin),
        replyTokens: reply,
        size,
        reopen,
        signal,
        sent: this.#sent.get(taskId),
      });
      if (outcome.kind === "condensed") history = outcome.history;
      if (outcome.kind !== "cancelled")
        await this.#record(taskId, outcome, {
          afterRefusal,
          targetTokens: target,
          tokensBefore: before,
          tokensAfter: size(history.messages()),
        });
    }
    await this.#publish(taskId, plan, history);
    return history;
  }

  /**
   * The size a request must grow past before condensing is tried again: the
   * last attempt's, when it failed or left the request past a target that is
   * still the same. Read from the saved record, so it holds after a restart.
   */
  #waitingToGrow(taskId: string, target: number): number | undefined {
    const last = this.#records.task(taskId).condensings?.at(-1);
    if (!last || last.targetTokens !== target) return undefined;
    if (last.outcome === "failed") return last.tokensBefore;
    return last.tokensAfter > target ? last.tokensAfter : undefined;
  }

  /**
   * Saves the attempt where it happened in the conversation. A failure that
   * repeats the last one, for the same reason at the same size, is not saved
   * again, so asking repeatedly with nothing new leaves one notice.
   */
  async #record(
    taskId: string,
    outcome: Exclude<CondensingOutcome, { kind: "cancelled" }>,
    sizes: {
      readonly afterRefusal: boolean;
      readonly targetTokens: number;
      readonly tokensBefore: number;
      readonly tokensAfter: number;
    },
  ): Promise<void> {
    const task = this.#records.task(taskId);
    const last = task.condensings?.at(-1);
    if (
      outcome.kind === "failed" &&
      last?.outcome === "failed" &&
      last.reason === outcome.reason &&
      last.detail === outcome.detail &&
      last.targetTokens === sizes.targetTokens &&
      last.tokensBefore === sizes.tokensBefore
    )
      return;
    const common = {
      id: `condensing-${this.#deps.newMessageId()}`,
      sequence: this.#records.nextTimelineSequence(task),
      createdAt: this.#deps.now().toISOString(),
      targetTokens: sizes.targetTokens,
      tokensBefore: sizes.tokensBefore,
      ...(sizes.afterRefusal ? { afterRefusal: true as const } : {}),
    };
    const record: TaskCondensing =
      outcome.kind === "condensed"
        ? {
            ...common,
            outcome: "condensed",
            revision: outcome.revision,
            throughMessageId: outcome.throughMessageId,
            tokensAfter: sizes.tokensAfter,
            messages: outcome.messages,
            actions: outcome.actions,
            summary: outcome.summary,
            ...(outcome.carried ? { carried: outcome.carried } : {}),
            ...(outcome.reread.length ? { reread: outcome.reread } : {}),
          }
        : {
            ...common,
            outcome: "failed",
            reason: outcome.reason,
            ...(outcome.detail ? { detail: outcome.detail } : {}),
          };
    await this.#records.replaceTask({
      ...task,
      condensings: [...(task.condensings ?? []), record],
    });
  }

  /** The provider's count of the request just sent. */
  counted(
    taskId: string,
    plan: RequestPlan,
    sent: readonly ModelMessage[],
    usage: ModelUsage | undefined,
  ): void {
    this.#sent.set(taskId, sent.length);
    if (usage) this.#size.counted(taskId, this.#parts(plan, sent), usage);
  }

  #parts(plan: RequestPlan, history: readonly ModelMessage[]) {
    return {
      model: this.#deps.host.modelWindow().model,
      fixed: plan.fixed,
      history,
      tools: plan.tools as readonly ModelTool[],
    };
  }

  /**
   * Every result older than the protected rounds, saved and replaced by a
   * receipt in one change, when results have piled up and enough would go.
   * A result that could not be saved stays as it is: nothing is dropped.
   */
  async #clearOlderResults(
    taskId: string,
    history: ModelHistory,
    target: number,
  ): Promise<void> {
    const results = history.results();
    const tokens = (content: string) => estimatedTokens(content);
    const all = results.reduce((sum, item) => sum + tokens(item.content), 0);
    if (all < target * clearFrom) return;
    const older = results.filter(
      (item) =>
        item.roundsAfter >= protectedRounds &&
        !item.content.startsWith(clearedMark),
    );
    const freed = older.reduce(
      (sum, item) => sum + tokens(item.content) - tokens(clearedReceipt("")),
      0,
    );
    if (freed < target * leastCleared) return;
    const replacements = new Map<string, string>();
    for (const item of older) {
      const kept = await this.#deps.sessions
        .keep("output", taskId, { text: item.content })
        .catch(() => undefined);
      if (kept?.status === "kept")
        replacements.set(item.entryId, clearedReceipt(kept.id));
    }
    await history.replaceResults(replacements);
  }

  /** How full the request about to be sent is, for the window to show. */
  async #publish(
    taskId: string,
    plan: RequestPlan,
    history: ModelHistory,
  ): Promise<void> {
    const messages = history.messages();
    const size = this.#size.of(taskId, this.#parts(plan, messages));
    const task = this.#records.task(taskId);
    const summary = task.compaction && messages[0] ? [messages[0]] : [];
    const rest = messages.slice(summary.length);
    const results = rest.filter((message) => message.role === "tool");
    const contextUsage: ContextUsage = {
      model: this.#deps.host.modelWindow().model,
      totalTokens: size.tokens,
      measured: size.measured,
      parts: {
        instructions: estimatedRequestTokens(plan.fixed, []),
        tools: estimatedRequestTokens([], plan.tools as readonly ModelTool[]),
        summary: summary.length ? estimatedRequestTokens(summary, []) : 0,
        conversation: estimatedRequestTokens(
          rest.filter((message) => message.role !== "tool"),
          [],
        ),
        toolResults: results.length ? estimatedRequestTokens(results, []) : 0,
      },
    };
    await this.#records.replaceTask({ ...task, contextUsage });
  }
}
