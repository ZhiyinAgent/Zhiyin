/**
 * Memory's side of one turn (ADR 0026): what the turn starts with, the
 * notices due before each request, the `remember` and `recall` calls it
 * answers, an answer that ends the turn on keeping something, and when the
 * turn's work is looked back over for what should last.
 */

import type { StandingInstruction, ToolSpec } from "@zhiyin/contract";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { ModelHistory } from "../context/model-history.js";
import type { LoopTool } from "../round/loop-tool.js";
import type { TurnHooks } from "../turn/turn-hooks.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import type {
  ConversationMemory,
  MemoryAtStart,
} from "./conversation-memory.js";
import { MemoryCalls } from "./memory-calls.js";
import {
  roundsBeforeReview,
  type MemoryReview,
  type ReviewedTurn,
} from "./memory-review.js";

type TurnMemoryParts = {
  readonly deps: Pick<AgentLoopDependencies, "memory">;
  readonly records: TurnRecords;
  readonly memory: ConversationMemory;
  readonly review: MemoryReview;
  readonly taskId: string;
} & Pick<ReviewedTurn, "ledger" | "lastRequest">;

export class TurnMemory implements LoopTool, TurnHooks {
  readonly #parts: TurnMemoryParts;
  readonly #calls: MemoryCalls;
  /** What memory the turn started with; nothing without memory. */
  #atStart: MemoryAtStart | undefined;
  /** Tool rounds of work since the turn was last looked back over. */
  #rounds = 0;
  /** The turn kept something in memory. */
  #remembered = false;
  /** A `remember` call of the round now answered was refused. */
  #keepRefused = false;

  private constructor(
    parts: TurnMemoryParts,
    atStart: MemoryAtStart | undefined,
    offered: readonly ToolSpec[],
  ) {
    this.#parts = parts;
    this.#atStart = atStart;
    this.#calls = new MemoryCalls(parts.memory, {
      taskId: parts.taskId,
      offered,
      writer: { outsideTurn: false },
      heard: (call, change) => {
        if (change) this.#remembered = true;
        else if (parts.memory.keeps(call.name)) this.#keepRefused = true;
      },
    });
  }

  /**
   * Memory as a turn starts: a look back over the last turn ends, since this
   * one may change what it reads, and what memory holds is read.
   */
  static async begin(parts: TurnMemoryParts): Promise<TurnMemory> {
    parts.review.stop(parts.taskId);
    const atStart = await parts.memory.atStart(parts.taskId);
    const offered = await parts.memory.offered(
      parts.records.task(parts.taskId),
      "turn",
    );
    return new TurnMemory(parts, atStart, offered);
  }

  /** The person's instructions memory holds, for the turn's standing instructions. */
  get instructions(): readonly StandingInstruction[] | undefined {
    return this.#atStart?.instructions;
  }

  specs(): readonly ToolSpec[] {
    return this.#calls.specs();
  }

  answers(name: string): boolean {
    return this.#calls.answers(name);
  }

  answer(
    call: AssembledToolCall,
    input: Record<string, unknown>,
  ): Promise<Readonly<Record<string, unknown>>> {
    return this.#calls.answer(call, input);
  }

  /** What memory holds when the conversation does not have it, and what a look back kept. */
  async beforeRequest(history: ModelHistory): Promise<void> {
    const { memory, taskId } = this.#parts;
    if (this.#atStart && (await memory.sendKnown(history, this.#atStart)))
      this.#atStart = { ...this.#atStart, moved: false };
    await memory.deliverKept(taskId, history);
  }

  async afterRound(): Promise<void> {
    this.#rounds += 1;
  }

  /**
   * An answer that ends with only keeping something in memory ends the turn
   * there: what was kept reaches the model with its next request. One whose
   * write was refused goes on, so the model can write it again.
   */
  endsTurn(round: {
    readonly text: string;
    readonly calls: readonly AssembledToolCall[];
  }): boolean {
    const refused = this.#keepRefused;
    this.#keepRefused = false;
    return (
      Boolean(round.text.trim()) &&
      !refused &&
      round.calls.every((call) => this.#parts.memory.keeps(call.name))
    );
  }

  /**
   * Looks back over a work turn that kept nothing, for what to remember: one
   * that used enough tool rounds and ended with an answer, or reached its
   * budget and is about to be condensed.
   */
  doneWith(how: Parameters<NonNullable<TurnHooks["doneWith"]>>[0]): void {
    const { memory, records, review, taskId, ledger, lastRequest } =
      this.#parts;
    if (
      how.incomplete ||
      how.reportOnly ||
      this.#remembered ||
      this.#rounds < roundsBeforeReview ||
      !this.specs().some((tool) => memory.keeps(tool.name)) ||
      records.task(taskId).memoryOff
    )
      return;
    review.start({
      taskId,
      fixed: how.request.fixed,
      tools: how.request.tools,
      ...(how.request.loads ? { loads: how.request.loads } : {}),
      ledger,
      lastRequest,
    });
    // The work looked back over is not looked back over again.
    this.#rounds = 0;
  }
}
