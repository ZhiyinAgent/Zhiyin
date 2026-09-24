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
  type ToolSpec,
} from "@zhiyin/contract";
import type { ModelMessage, ModelTool, ModelUsage } from "@zhiyin/model-client";
import { estimatedRequestTokens } from "./conversation-context.js";
import { Condensing } from "./condensing.js";
import type { ModelHistory } from "./model-history.js";
import { harnessNotice } from "./notices.js";
import { RequestSize } from "./request-size.js";
import type { TurnRecords } from "./turn-records.js";
import type { AgentLoopDependencies } from "./dependencies.js";

const clearFrom = 0.4;
const leastCleared = 0.2;
export const protectedRounds = 5;
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
  readonly #failedAt = new Map<string, number>();

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

  /**
   * The history to send next: older results cleared when they have piled up,
   * and condensed when the request is past its budget.
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
    const failed = this.#failedAt.get(taskId);
    if (before > target && !(failed && before < failed * regrowth)) {
      const model = this.#deps.host.modelWindow();
      const window = model.contextWindow ?? assumedWindow;
      const reply = Math.min(
        model.maximumOutputTokens ?? replyReserve,
        replyReserve,
      );
      const condensed = await this.#condensing.condense({
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
      });
      if (condensed) history = condensed;
      // A condensing that failed, or left the request still past its budget,
      // is not tried again on every call: only once the request has grown.
      const after = condensed ? size(history.messages()) : before;
      if (after > target) this.#failedAt.set(taskId, after);
      else this.#failedAt.delete(taskId);
    }
    await this.#publish(taskId, plan, history);
    return history;
  }

  /** The provider's count of the request just sent. */
  counted(
    taskId: string,
    plan: RequestPlan,
    sent: readonly ModelMessage[],
    usage: ModelUsage | undefined,
  ): void {
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
