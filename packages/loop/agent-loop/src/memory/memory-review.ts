/**
 * A look back over a work turn for what to remember (ADR 0026).
 *
 * After a turn that used three or more tool rounds without keeping anything,
 * its last request is sent once more, as it was, with one notice added that
 * asks whether anything should last. The provider reads almost all of it from
 * its cache. From the notice on, the model can call `remember` and `recall`
 * alone: the turn's other tools stay in the request for its cache on every
 * lab, the model client keeps them out of reach where the provider can (ADR
 * 0026), and a call to one is refused here (ADR 0016). It takes six rounds at
 * most, the most a look back needed in the measure plus one. None of it joins
 * the conversation: what was kept is shown in the conversation's card, and
 * told to the model with its next request. It runs beside the conversation,
 * so the person is never kept waiting, and Stop ends it.
 */

import type { ToolSpec } from "@zhiyin/contract";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";
import { ModelHistory } from "../context/model-history.js";
import {
  ModelRound,
  type ModelRoundDependencies,
} from "../turn/model-round.js";
import {
  modelRoundRequest,
  type RequestBefore,
} from "../request/round-request.js";
import { asTheModelSees } from "../turn/turn-pictures.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import type { WorkLedger } from "../turn/work-limits.js";
import { RoundAnswers, type RoundRules } from "../round/round-answers.js";
import { QuietFailures } from "../tools/quiet-failures.js";
import { refusal } from "../tools/refusals.js";
import type { ConversationMemory } from "./conversation-memory.js";
import { MemoryCalls } from "./memory-calls.js";

/** What looking back over a turn uses. */
export type MemoryReviewDependencies = Pick<
  AgentLoopDependencies,
  "afterCalls" | "host" | "kept" | "memory" | "newMessageId" | "recordDefect"
> &
  ModelRoundDependencies;

/** Tool rounds a turn takes before it is looked back over. */
export const roundsBeforeReview = 3;
/** Rounds a look back may take: the most one needed, measured, plus one. */
const reviewRounds = 6;

const reviewAsk = [
  "Before this conversation goes on: is there anything from it that should last beyond it and is not kept in memory yet?",
  "Most of the time there is nothing, and then call nothing. Keep only what the remember tool's description says is worth keeping. Look with recall before keeping something new, and change the entry that covers a subject rather than add another.",
  "Only remember and recall can be called now. Nothing you write here is shown to the person.",
].join("\n");

const onlyMemory = refusal(
  "input-check",
  "The turn is over: its work waits for the person's next message. Only remember and recall can be called while looking back.",
  "Call remember or recall, or call nothing.",
);

/** What a finished turn hands its look back. */
export type ReviewedTurn = {
  readonly taskId: string;
  /** The start of every request of the turn, and the tools it offered. */
  readonly fixed: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
  /** The tools the turn's requests loaded beside them, where they were (ADR 0017). */
  readonly loads?: (history: readonly ModelMessage[]) => ModelRequest["loads"];
  readonly ledger: WorkLedger;
  /** The turn's last request, for the provider's cache. */
  readonly lastRequest: ReadonlyMap<string, RequestBefore>;
};

export class MemoryReview {
  readonly #deps: MemoryReviewDependencies;
  readonly #records: TurnRecords;
  readonly #memory: ConversationMemory;
  readonly #round: ModelRound;
  readonly #answers: RoundAnswers;
  readonly #running = new Map<string, AbortController>();

  constructor(
    deps: MemoryReviewDependencies,
    records: TurnRecords,
    memory: ConversationMemory,
  ) {
    this.#deps = deps;
    this.#records = records;
    this.#memory = memory;
    this.#round = new ModelRound(deps, records, "memory");
    this.#answers = new RoundAnswers(deps);
  }

  /** Starts a look back beside the conversation; it settles on its own. */
  start(turn: ReviewedTurn): void {
    this.stop(turn.taskId);
    const controller = new AbortController();
    this.#running.set(turn.taskId, controller);
    void this.#review(turn, controller)
      .catch((error: unknown) => {
        // Nothing the person asked for depends on it: a failure keeps
        // nothing more, and is kept where Zhiyin's own errors are read.
        if (!controller.signal.aborted)
          this.#deps.recordDefect?.({ taskId: turn.taskId, error });
      })
      .finally(() => {
        if (this.#running.get(turn.taskId) === controller)
          this.#running.delete(turn.taskId);
      });
  }

  /** Ends every look back. */
  stopAll(): void {
    for (const taskId of [...this.#running.keys()]) this.stop(taskId);
  }

  /** Ends the conversation's look back, if one runs. */
  stop(taskId: string): void {
    this.#running.get(taskId)?.abort();
    this.#running.delete(taskId);
  }

  async #review(
    turn: ReviewedTurn,
    controller: AbortController,
  ): Promise<void> {
    const { taskId, fixed, tools, ledger, loads } = turn;
    const signal = controller.signal;
    // A copy of the conversation's history: nothing of the look back is saved
    // into the conversation.
    const history = await ModelHistory.open(this.#records.task(taskId), {
      newId: () => this.#deps.newMessageId(),
      readPicture: (source) => this.#deps.kept.readPicture(source),
      save: async () => {},
    });
    await history.notice("review", reviewAsk);
    const lengths = new Map(turn.lastRequest);
    const kept: string[] = [];
    // The memory tools as the turn offered them: the look back sends the
    // turn's own request, tools and all.
    const offered = tools.filter((tool) => this.#memory.answers(tool.name));
    const rules = this.#rules(taskId, signal, history, kept, offered);
    /** Where the notice is: the look back only appends after it. */
    let notice: number | undefined;
    for (let round = 0; round < reviewRounds; round += 1) {
      signal.throwIfAborted();
      const messages = [
        ...fixed,
        ...asTheModelSees(history.messages(), this.#deps.host.acceptsImages()),
      ];
      notice ??= messages.length - 1;
      const loaded = loads?.(history.messages());
      const request = {
        ...modelRoundRequest(
          this.#records.task(taskId),
          this.#deps.host.reasoningControls(),
          messages,
          tools,
          fixed.length,
          lengths,
          history.firstPictureThatCanGo(),
        ),
        callable: { tools: offered.map((tool) => tool.name), after: notice },
        ...(loaded ? { loads: loaded } : {}),
      };
      const answered = await this.#round.run(
        taskId,
        controller,
        ledger,
        request,
        () => !signal.aborted,
      );
      if (!answered.calls.length) break;
      await this.#answers.answer(answered, rules);
      signal.throwIfAborted();
    }
    if (kept.length && !signal.aborted)
      await this.#memory.writeKept(taskId, kept);
  }

  /**
   * How a look back's rounds are answered: memory alone, as it is on offer at
   * each call, since the person may have turned it off or asked to keep
   * nothing since the turn ended; every write outside any turn, noting what
   * it kept. Nothing of a call is recorded in the conversation, so its input
   * is read as it stands, with nothing fixed.
   */
  #rules(
    taskId: string,
    signal: AbortSignal,
    history: ModelHistory,
    kept: string[],
    offered: readonly ToolSpec[],
  ): RoundRules {
    const answered = new MemoryCalls(this.#memory, {
      taskId,
      offered,
      writer: { outsideTurn: true },
      heard: (_call, change) => {
        if (change && change.change !== "waiting")
          kept.push(
            `#${change.number ?? "?"} ${change.title} (${change.scopeName}): ${change.change}`,
          );
      },
    });
    return {
      taskId,
      signal,
      transcript: history,
      quiet: new QuietFailures(),
      offered: [],
      loopTools: [answered],
      readInput: async (call) => readAsItStands(call),
      screen: async (call) => {
        const now = await this.#memory.offered(
          this.#records.task(taskId),
          "review",
        );
        return now.some((tool) => tool.name === call.name)
          ? undefined
          : onlyMemory;
      },
    };
  }
}

/** A call's input as one object, or what the model is told instead. */
function readAsItStands(call: AssembledToolCall) {
  let input: unknown;
  try {
    input = JSON.parse(call.arguments || "{}");
  } catch {
    return {
      ok: false as const,
      result: refusal(
        "input-check",
        "The input is not valid JSON.",
        "Send the call again with its arguments as one JSON object.",
      ),
      quiet: false,
    };
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return {
      ok: false as const,
      result: refusal(
        "input-check",
        `${call.name} takes an object of its fields.`,
        "Send the call again with its arguments as one JSON object.",
      ),
      quiet: false,
    };
  return { ok: true as const, arguments: input as Record<string, unknown> };
}
