/**
 * The tool-calling round loop a turn runs, from gathering what it can call
 * through repeating rounds until it has nothing left to say. Shared between a
 * turn a person just started and one woken automatically for a background
 * specialist's handoff or a command that ended — the two differ only in what
 * happens before this begins (a fresh message from the person, or nothing).
 */

import { VisibleError } from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { QuietFailures } from "../tools/quiet-failures.js";
import { LoopGuard } from "./loop-guard.js";
import { PlanProgress } from "../plan/plan-progress.js";
import { StandingInstructions } from "../context/standing-instructions.js";
import { noteWorkspace } from "../context/workspace-notice.js";
import {
  keepReadiness,
  noteReadiness,
} from "../context/directory-readiness.js";
import { asTheModelSees } from "./turn-pictures.js";
import { deliverBackgroundWork } from "./background-deliveries.js";
import type { ModelHistory } from "../context/model-history.js";
import {
  AnswerNow,
  ModelRound,
  SentNow,
  ThoughtTooLong,
  withLeastReasoning,
  type RoundResult,
  type ModelRoundDependencies,
} from "./model-round.js";
import { RoundResults, resultLimits } from "../context/result-size.js";
import type { ContextGuard } from "../context/context-guard.js";
import {
  openTaskHistory,
  type HistoryDependencies,
} from "../request/request-plan.js";
import {
  modelRoundRequest,
  type RequestBefore,
} from "../request/round-request.js";
import { ToolCalls } from "../tools/tool-calls.js";
import { SpecialistExecution } from "../specialist/specialist-execution.js";
import { Delegation } from "../specialist/delegation.js";
import { PluginActivation } from "../tools/plugin-activation.js";
import { CatalogTools } from "../tools/catalog-tools.js";
import { SetupCards } from "../tools/setup-card.js";
import { PendingHandoffs } from "../specialist/pending-handoffs.js";
import type { CommandEndings } from "../tools/command-endings.js";
import { TurnRecords } from "./turn-records.js";
import { showsPrompt } from "./progress-records.js";
import { TurnWaits } from "./turn-waits.js";
import { TurnOwnership } from "./turn-ownership.js";
import { TurnOffering, type OfferingStart } from "./turn-offering.js";
import type { LoopTool } from "../round/loop-tool.js";
import { MemoryCalls } from "../memory/memory-calls.js";
import { RoundAnswers } from "../round/round-answers.js";
import { PictureSending } from "./picture-sending.js";
import type { TurnHooks } from "./turn-hooks.js";
import { StudioReview, type ReviewRunning } from "./studio-review.js";
import { WorkChecks } from "./work-checks.js";
import { deliverGuidance } from "./turn-guidance.js";
import { completionPhase } from "./turn-completion.js";
import {
  recoverAnswerNow,
  recoverConnectionFailure,
  recoverLongThought,
  recoverSentNow,
  isOwnDefect,
  turnFailureReason,
  turnFailureRemedies,
} from "./turn-recovery.js";
import {
  describedWorkspace,
  namelessCallFailure,
  noLongerFits,
  TurnFailure,
  pauseReportInstruction,
  refusedAsTooLong,
  type RoundTools,
} from "./turn-shared.js";
import { renewalNotice, type WorkLedger } from "./work-limits.js";
import type { AgentLoopDependencies, ReviewerModel } from "../dependencies.js";
import {
  gatherTools,
  type GatherDependencies,
} from "../tools/tool-gathering.js";
import { ConversationMemory } from "../memory/conversation-memory.js";
import { MemoryReview } from "../memory/memory-review.js";
import { TurnMemory } from "../memory/turn-memory.js";

/** What running a turn's rounds uses. */
export type TurnLoopDependencies = Pick<
  AgentLoopDependencies,
  | "afterCalls"
  | "host"
  | "kept"
  | "memory"
  | "newMessageId"
  | "newSpecialistRunId"
  | "now"
  | "pictures"
  | "recordDefect"
  | "reviews"
  | "timeZone"
  | "workspace"
> &
  ModelRoundDependencies &
  GatherDependencies &
  HistoryDependencies;

/** What one run of the loop carries from round to round. */
type Turn = {
  readonly taskId: string;
  readonly controller: AbortController;
  readonly ledger: WorkLedger;
  readonly offering: TurnOffering;
  /**
   * What the plan, the standing instructions and memory each do at the
   * turn's moments, asked in this order.
   */
  readonly hooks: readonly TurnHooks[];
  readonly quiet: QuietFailures;
  readonly guard: LoopGuard;
  /** Whether the files the turn changed were checked. */
  readonly checks: WorkChecks;
  /** What the turn has said, a part for each round that said something. */
  readonly said: string[];
  /**
   * The model has ended a round with an answer, shown to the person: a later
   * round that ends with nothing, as a notice may ask, ends the turn there.
   */
  answered: boolean;
  history: ModelHistory;
  /** The person paused the work: the model reports, and calls nothing. */
  reportOnly: boolean;
  /** The provider refused this step as too long, and it was condensed. */
  refused: boolean;
  /** One fresh round may resume from completed tools after retry exhaustion. */
  connectionRecoveries: number;
  /**
   * This step's request was stopped for reasoning at length, and is asked
   * again with the least reasoning the model can be asked for.
   */
  overthought: boolean;
  /**
   * The person asked for the answer now: the turn's remaining requests go
   * with the least reasoning the model can be asked for.
   */
  answerNow: boolean;
};

export class TurnLoop {
  readonly #deps: TurnLoopDependencies;
  readonly #records: TurnRecords;
  readonly #waits: TurnWaits;
  readonly #toolCalls: ToolCalls;
  readonly #specialists: SpecialistExecution;
  readonly #reviewing: (reviewer: ReviewerModel) => ReviewRunning;
  readonly #pluginActivation: PluginActivation;
  readonly #ownership: TurnOwnership;
  readonly #pendingHandoffs: PendingHandoffs;
  readonly #commandEndings: CommandEndings;
  readonly #round: ModelRound;
  readonly #context: ContextGuard;
  readonly #instructions: StandingInstructions;
  readonly #memory: ConversationMemory;
  readonly #review: MemoryReview;
  readonly #answers: RoundAnswers;
  /** Each conversation's last request, to mark where the next repeats it. */
  readonly #lastRequest = new Map<string, RequestBefore>();

  constructor(
    deps: TurnLoopDependencies,
    parts: {
      readonly records: TurnRecords;
      readonly waits: TurnWaits;
      readonly toolCalls: ToolCalls;
      readonly specialists: SpecialistExecution;
      /** Specialists run on the model the person chose for reviews. */
      readonly reviewing: (reviewer: ReviewerModel) => ReviewRunning;
      readonly pluginActivation: PluginActivation;
      readonly ownership: TurnOwnership;
      readonly pendingHandoffs: PendingHandoffs;
      readonly commandEndings: CommandEndings;
      readonly context: ContextGuard;
      /** Told when the lab refuses one of the turn's requests for their number. */
      readonly rateLimited: (taskId: string) => void;
      readonly instructions: StandingInstructions;
      readonly memory: ConversationMemory;
      readonly review: MemoryReview;
    },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
    this.#waits = parts.waits;
    this.#instructions = parts.instructions;
    this.#toolCalls = parts.toolCalls;
    this.#specialists = parts.specialists;
    this.#reviewing = parts.reviewing;
    this.#pluginActivation = parts.pluginActivation;
    this.#ownership = parts.ownership;
    this.#pendingHandoffs = parts.pendingHandoffs;
    this.#commandEndings = parts.commandEndings;
    this.#round = new ModelRound(
      deps,
      parts.records,
      "conversation",
      parts.rateLimited,
    );
    this.#context = parts.context;
    this.#memory = parts.memory;
    this.#review = parts.review;
    this.#answers = new RoundAnswers(deps);
  }

  /** Ends the conversation's look back over its last turn, if one runs. */
  stopReview(taskId: string): void {
    this.#review.stop(taskId);
  }

  /** Ends every look back, as the app closes. */
  stopReviews(): void {
    this.#review.stopAll();
  }

  /**
   * Stops the reasoning of the conversation's request, for the turn to ask
   * for the answer at once. Says whether a request was only reasoning.
   */
  answerNow(taskId: string): boolean {
    return this.#round.answerNow(taskId);
  }

  /**
   * Has what the person added sent now: where a message waits and the
   * conversation's request has only reasoned, that request is stopped and
   * the turn asks again with the message. Says whether it was.
   */
  sendNow(taskId: string): boolean {
    return (
      this.#records
        .task(taskId)
        .guidance.some((item) => item.status === "pending") &&
      this.#round.sendNow(taskId)
    );
  }

  async run(
    taskId: string,
    controller: AbortController,
    ledger: WorkLedger,
    options?: {
      /** Specialist count carried across a background wake. */
      readonly initialDelegatedChildren?: number;
    },
  ): Promise<void> {
    try {
      const turn = await this.#begin(taskId, controller, ledger, options);
      while (true) {
        const answered = await this.#ask(turn);
        if (!answered) continue;
        if (controller.signal.aborted) {
          await this.#interruptIfCurrent(taskId, controller);
          return;
        }

        const { calls, text, reasoning, finishReason, response } = answered;
        // Ending with nothing after an answer was shown is the end the
        // plan's reminder asks for, not a stop before any answer.
        const endsAfterAnswer =
          turn.answered &&
          calls.length === 0 &&
          !text.trim() &&
          finishReason !== undefined &&
          finishReason !== "length";
        const incomplete =
          !endsAfterAnswer &&
          (finishReason === "length" ||
            response?.complete === false ||
            (calls.length === 0 && !text.trim() && Boolean(reasoning)));
        if (calls.length === 0 && text.trim() && !incomplete)
          turn.answered = true;

        await this.#keepRound(taskId, answered, incomplete);
        if (text.trim()) turn.said.push(text);
        if (turn.reportOnly && calls.length > 0) {
          await this.#records.finishPausedReport(
            taskId,
            turn.said.join("\n\n"),
          );
          return;
        }
        if (calls.length === 0) {
          const ending = await this.#afterLastWords(turn, answered, incomplete);
          if (ending === "ended") return;
          continue;
        }
        const budget = await this.#atBudget(turn);
        if (budget === "stopped") return;
        if (budget === "paused") continue;
        const round = await this.#answerCalls(turn, answered, {
          renewed: budget === "renewed",
        });
        if (round === "stopped") return;
        // Every hook is asked, so each can let go of what the round left it.
        const ends = turn.hooks
          .map((hook) => hook.endsTurn?.({ text, calls }) ?? false)
          .some(Boolean);
        if (ends) {
          const ending = await this.#afterLastWords(turn, answered, false, {
            inHistory: true,
          });
          if (ending === "ended") return;
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        await this.#interruptIfCurrent(taskId, controller);
        return;
      }
      if (isOwnDefect(error)) this.#deps.recordDefect?.({ taskId, error });
      const task = this.#records.task(taskId);
      const remedies = turnFailureRemedies(error, ledger.completedToolRounds());
      await this.#records.replaceTask({
        ...task,
        // A specialist still waiting on the person keeps its question on
        // screen, as when the turn finishes.
        phase:
          showsPrompt(task.phase) &&
          this.#waits.awaitsAnswer(taskId, task.phase.prompt.id)
            ? task.phase
            : {
                kind: "failed",
                reason: turnFailureReason(error, ledger.completedToolRounds()),
                ...(remedies.length ? { remedies } : {}),
              },
      });
    } finally {
      if (this.#ownership.finish(taskId, controller)) {
        await this.#records.guidance.release(taskId);
        this.#records.progress.forget(taskId);
      }
    }
  }

  /**
   * What a turn starts from: the workspace as it is, the tools gathered for
   * it, the conversation's history and the person's standing instructions.
   */
  async #begin(
    taskId: string,
    controller: AbortController,
    ledger: WorkLedger,
    options: Parameters<TurnLoop["run"]>[3],
  ): Promise<Turn> {
    const workspace = await describedWorkspace(this.#deps.workspace, taskId);
    controller.signal.throwIfAborted();
    this.#deps.host.watchBrowser(taskId);
    const memory = await TurnMemory.begin({
      deps: this.#deps,
      records: this.#records,
      memory: this.#memory,
      review: this.#review,
      taskId,
      ledger,
      lastRequest: this.#lastRequest,
    });
    const activatedPlugins = this.#records.task(taskId).activatedPlugins;
    const gathered = await gatherTools(
      this.#deps,
      this.#records,
      taskId,
      activatedPlugins,
    );
    if (!gathered.ok) throw new VisibleError(gathered.reason);
    const readiness = await keepReadiness(
      this.#records,
      taskId,
      gathered.value.pluginDirectory,
    );
    const plan = new PlanProgress(this.#records, taskId);
    const history = await this.#openHistory(taskId);
    // What the turn has opened is read from its history as it stands, which
    // a condensing replaces.
    const current: { turn?: Turn } = {};
    const offering = this.#offering(
      taskId,
      {
        workspace,
        startedAt: this.#deps.now(),
        timeZone: this.#deps.timeZone,
        gathered: gathered.value,
        activatedPlugins,
        route: this.#deps.host.toolLoading(),
        readiness,
      },
      { memory, plan, delegated: options?.initialDelegatedChildren ?? 0 },
      () => (current.turn?.history ?? history).messages(),
    );
    const standing = await this.#instructions.gather(
      taskId,
      controller.signal,
      this.#context.targetTokens(taskId),
      memory.instructions,
    );
    const startedAt = this.#deps.now();
    const checks = new WorkChecks((name) =>
      offering.offered().find((tool) => tool.name === name),
    );
    const turn: Turn = {
      taskId,
      controller,
      ledger,
      offering,
      hooks: [
        { beforeRequest: (history) => offering.tellRoute(history) },
        { beforeRequest: (history) => noteWorkspace(history, workspace) },
        {
          beforeRequest: (history) =>
            noteReadiness(history, offering.pluginDirectory, readiness),
        },
        plan,
        { beforeRequest: (sent) => standing.send(sent) },
        memory,
        checks,
        new StudioReview(
          this.#deps,
          {
            records: this.#records,
            execution: this.#specialists,
            reviewing: this.#reviewing,
          },
          { taskId, offer: offering, startedAt },
        ),
      ],
      checks,
      quiet: new QuietFailures(),
      guard: new LoopGuard(),
      said: [],
      answered: false,
      history,
      reportOnly: false,
      refused: false,
      connectionRecoveries: 0,
      overthought: false,
      answerNow: false,
    };
    current.turn = turn;
    return turn;
  }

  /**
   * What a turn would offer now, for a request made between turns: the same
   * start and tools, in the same order, though nothing here answers them.
   */
  async offeringBetweenTurns(
    taskId: string,
    start: OfferingStart,
    conversation: () => readonly ModelMessage[],
  ): Promise<TurnOffering> {
    const memory = new MemoryCalls(this.#memory, {
      taskId,
      offered: await this.#memory.offered(this.#records.task(taskId), "turn"),
      writer: { outsideTurn: false },
    });
    return this.#offering(
      taskId,
      start,
      {
        memory,
        plan: new PlanProgress(this.#records, taskId),
        delegated: 0,
      },
      conversation,
    );
  }

  /**
   * What a turn offers: what it gathered, and the loop's own tools in the
   * order they are offered: memory, the plan, delegating to a specialist,
   * the catalog and the setup card.
   */
  #offering(
    taskId: string,
    start: OfferingStart,
    own: {
      readonly memory: LoopTool;
      readonly plan: PlanProgress;
      readonly delegated: number;
    },
    conversation: () => readonly ModelMessage[],
  ): TurnOffering {
    const activation = this.#pluginActivation;
    return new TurnOffering({
      ...start,
      conversation,
      changes: {
        activate: (plugin, activated) =>
          activation.activate(taskId, plugin, activated),
        gatherAgain: (activated) => activation.gatherAgain(taskId, activated),
      },
      memoryTools: own.memory.specs(),
      loopTools: (offer) => [
        own.memory,
        own.plan,
        new Delegation(this.#specialists, {
          taskId,
          offer,
          now: () => this.#deps.now(),
          delegated: own.delegated,
        }),
        new CatalogTools(this.#deps, {
          records: this.#records,
          taskId,
          offer,
        }),
        new SetupCards(this.#deps, {
          records: this.#records,
          taskId,
          directory: () => offer.pluginDirectory,
        }),
      ],
    });
  }

  /** The request as it stands: its fixed start, then the conversation so far. */
  #requestMessages(turn: Turn): ModelMessage[] {
    return [
      ...turn.offering.fixedMessages,
      ...asTheModelSees(
        turn.history.messages(),
        this.#deps.host.acceptsImages(),
      ),
    ];
  }

  /**
   * One request to the model, once everything due before it is in the
   * history: what the turn's hooks send (the plan's reminder, the standing
   * instructions, memory), background work that ended and what the person
   * said meanwhile, all brought to a size the model takes. Nothing comes back
   * from a round that failed and was recovered from: the loop asks again.
   */
  async #ask(turn: Turn): Promise<RoundResult | undefined> {
    const { taskId, controller, ledger, offering } = turn;
    // A stopped turn takes nothing more from what waits for the next one.
    controller.signal.throwIfAborted();
    for (const hook of turn.hooks) await hook.beforeRequest?.(turn.history);
    await deliverBackgroundWork(taskId, turn.history, {
      records: this.#records,
      pendingHandoffs: this.#pendingHandoffs,
      commandEndings: this.#commandEndings,
      kept: this.#deps.kept,
      signal: controller.signal,
    });
    if (await deliverGuidance(taskId, this.#records, turn.history))
      turn.guard.reset();
    const fixed = offering.fixedMessages;
    const plan = {
      fixed,
      tools: turn.reportOnly ? [] : offering.advertised(),
      loads: (history: readonly ModelMessage[]) => offering.loads(history),
    };
    turn.history = await this.#context.prepare(
      taskId,
      turn.history,
      plan,
      () => this.#openHistory(taskId),
      controller.signal,
      // What the condensed part held is done with as it is let go.
      () => this.#doneWith(turn, false),
    );
    controller.signal.throwIfAborted();
    const messages = this.#requestMessages(turn);
    // A toolkit opened reaches a lab that loads tools natively beside the
    // request, where it was opened (ADR 0017).
    const loads = turn.reportOnly
      ? undefined
      : offering.loads(turn.history.messages());
    const planned = {
      ...modelRoundRequest(
        this.#records.task(taskId),
        this.#deps.host.reasoningControls(),
        messages,
        plan.tools,
        fixed.length,
        this.#lastRequest,
        turn.history.firstPictureThatCanGo(),
      ),
      ...(loads ? { loads } : {}),
    };
    const request =
      turn.answerNow || turn.overthought
        ? withLeastReasoning(planned, this.#deps.host.leastReasoning())
        : planned;
    const shown = this.#records.task(taskId).messages.length;
    const answered = await this.#round
      .run(taskId, controller, ledger, request, () =>
        this.#ownsTurn(taskId, controller),
      )
      .catch(async (error: unknown) => {
        await this.#recover(turn, error, shown);
        return undefined;
      });
    if (!answered) return undefined;
    turn.refused = false;
    turn.overthought = false;
    this.#context.counted(
      taskId,
      plan,
      messages.slice(fixed.length),
      answered.usage,
    );
    return answered;
  }

  /**
   * What a failed round is recovered from: a connection lost for good, resumed
   * once from the tools that completed, a request refused as too long,
   * condensed once per step, one stopped for reasoning at length, asked once
   * per step to decide with less reasoning, and one the person stopped, to
   * have the answer now or to have what they added read now.
   * Everything else is thrown on, and so is whatever ended a turn that was
   * stopped.
   */
  async #recover(turn: Turn, error: unknown, shown: number): Promise<void> {
    const { taskId, controller, ledger } = turn;
    // A stopped turn stays stopped, whatever its cancelled request
    // looked like when it ended: nothing here may resume it.
    if (controller.signal.aborted) throw error;
    if (error instanceof AnswerNow) {
      await recoverAnswerNow({
        taskId,
        messagesBeforeRound: shown,
        records: this.#records,
        history: turn.history,
      });
      turn.answerNow = true;
      return;
    }
    if (error instanceof SentNow) {
      await recoverSentNow({
        taskId,
        messagesBeforeRound: shown,
        records: this.#records,
      });
      return;
    }
    if (error instanceof ThoughtTooLong) {
      await recoverLongThought({
        taskId,
        messagesBeforeRound: shown,
        again: turn.overthought,
        records: this.#records,
        history: turn.history,
      });
      turn.overthought = true;
      return;
    }
    if (
      await recoverConnectionFailure({
        error,
        taskId,
        messagesBeforeRound: shown,
        previousRecoveries: turn.connectionRecoveries,
        records: this.#records,
        history: turn.history,
        ledger,
      })
    ) {
      turn.connectionRecoveries += 1;
      return;
    }
    // Recovered once per step, and only before any of an answer showed.
    const said = refusedAsTooLong(error);
    if (!said || this.#records.task(taskId).messages.length !== shown)
      throw error;
    if (turn.refused)
      throw new TurnFailure(noLongerFits, ["chooseLargerModel", "tryAgain"]);
    this.#context.refused(taskId, said);
    turn.refused = true;
  }

  /**
   * A round that called nothing ends the turn, unless one of these, checked
   * in this order, sends it on: what the person said meanwhile; then what the
   * turn's parts find open, the plan's open items and the files nothing
   * checked, told together in one notice once a turn; then, once nothing is
   * open, the studio review. The first that has something to say asks the
   * model again.
   */
  async #afterLastWords(
    turn: Turn,
    answered: RoundResult,
    incomplete: boolean,
    { inHistory = false }: { readonly inHistory?: boolean } = {},
  ): Promise<"resumed" | "ended"> {
    const { taskId, controller, guard, reportOnly } = turn;
    const { reasoning, replay, finishReason, assistantId, roundId } = answered;
    const answer = this.#records
      .task(taskId)
      .messages.find((message) => message.id === assistantId);
    // Words that came with calls are already in the history, with them.
    if (answer && !inHistory)
      await turn.history.answer(answer, {
        reasoning,
        ...(replay ? { replay } : {}),
        roundId,
      });
    if (await deliverGuidance(taskId, this.#records, turn.history)) {
      guard.reset();
      return "resumed";
    }
    if (!incomplete && !reportOnly) {
      // Every part is asked, so none is left to say its part a turn later.
      const open = turn.hooks.flatMap((hook) => hook.openAtEnd?.() ?? []);
      if (open.length) {
        await turn.history.notice(
          open.length === 1 ? open[0]!.kind : "finish",
          `Your answer above is already shown to the person. ${open.map((part) => part.text).join("\n")}`,
        );
        guard.reset();
        return "resumed";
      }
      for (const hook of turn.hooks)
        if (await hook.beforeFinishing?.(turn.history)) {
          guard.reset();
          return "resumed";
        }
    }
    const assistantText = turn.said.join("\n\n");
    controller.signal.throwIfAborted();
    const task = this.#records.task(taskId);
    await this.#records.replaceTask({
      ...task,
      // A specialist still waiting on the person keeps its question on
      // screen; its handoff starts the next turn once it finishes.
      phase: showsPrompt(task.phase)
        ? task.phase
        : completionPhase(
            task,
            assistantText,
            reportOnly,
            incomplete,
            finishReason === "length",
          ),
    });
    this.#doneWith(turn, incomplete);
    return "ended";
  }

  /** Tells the hooks the turn's work so far is done with. */
  #doneWith(turn: Turn, incomplete: boolean): void {
    const { offering } = turn;
    for (const hook of turn.hooks)
      hook.doneWith?.({
        incomplete,
        reportOnly: turn.reportOnly,
        request: {
          fixed: offering.fixedMessages,
          tools: offering.advertised(),
          loads: (history) => offering.loads(history),
        },
      });
  }

  /**
   * Where the work has reached its budget, the person decides: stop, pause
   * for a report of what was done, or go on with the budget renewed.
   */
  async #atBudget(
    turn: Turn,
  ): Promise<"within" | "stopped" | "paused" | "renewed"> {
    const { taskId, controller, ledger } = turn;
    const reached = ledger.reached(this.#deps.now());
    if (!reached.length) return "within";
    const decision = await this.#waits.waitForWorkBudget(
      taskId,
      ledger.checkpoint(this.#deps.now()),
      controller.signal,
      turn.guard.reason(),
    );
    if (decision === "cancelled") {
      await this.#interruptIfCurrent(taskId, controller);
      return "stopped";
    }
    await this.#records.progress.working(
      taskId,
      undefined,
      this.#records.progress.steps(taskId),
    );
    if (decision === "pause") {
      turn.said.length = 0;
      await turn.history.notice("pause", pauseReportInstruction);
      turn.reportOnly = true;
      return "paused";
    }
    ledger.renew(this.#deps.now());
    return "renewed";
  }

  /**
   * Answers the calls of a round in the order the model made them, and closes
   * the round: the loop's own tools as the turn offers them, every other call
   * through its tool, with the pictures it made. Says when the turn was
   * stopped meanwhile.
   */
  async #answerCalls(
    turn: Turn,
    answered: RoundResult,
    { renewed }: { readonly renewed: boolean },
  ): Promise<"answered" | "stopped"> {
    const { taskId, controller, ledger, offering, quiet, guard, history } =
      turn;
    const onOffer: RoundTools = {
      get tools() {
        return offering.offered();
      },
    };
    const round = await this.#answers.answer(answered, {
      taskId,
      signal: controller.signal,
      transcript: history,
      quiet,
      ...(this.#records
        .task(taskId)
        .messages.some((message) => message.id === answered.assistantId)
        ? { messageId: answered.assistantId }
        : {}),
      // As they stand at each call: activating a plugin or opening a toolkit
      // changes them.
      get offered() {
        return offering.offered();
      },
      loopTools: offering.loopTools,
      unwrap: (call) => offering.unwrap(call),
      screen: async (call) => offering.notOpened(call),
      readInput: (call, quietRetriesLeft) =>
        this.#toolCalls.readInput(taskId, call, {
          round: onOffer,
          quietRetriesLeft,
          signal: controller.signal,
        }),
      tools: {
        toolCalls: this.#toolCalls,
        ownerOf: (name) => offering.ownerOf(name),
        controller,
        round: onOffer,
        sizes: new RoundResults(
          (text) => this.#deps.kept.keep("output", taskId, { text }),
          resultLimits(this.#context.targetTokens(taskId)),
        ),
        pictures: new PictureSending(
          this.#deps,
          this.#records,
          taskId,
          history,
        ),
        observe: (name, input, outcome) => {
          guard.observe(name, input, outcome);
          turn.checks.observe(name, input, outcome);
        },
      },
    });
    if (round.stopped) {
      await this.#interruptIfCurrent(taskId, controller);
      return "stopped";
    }
    await guard.tell(history);
    if (renewed) await history.notice("renewal", renewalNotice(ledger));
    if (round.nameless) throw new VisibleError(namelessCallFailure);
    // A round of nothing but quiet corrections is the model fixing its own
    // input, not work done, so it does not count toward the budget.
    if (round.work) {
      ledger.completeToolRound();
      for (const hook of turn.hooks)
        await hook.afterRound?.(history, { calls: answered.calls });
    }
    return "answered";
  }

  /**
   * Keeps what a round brought beside its words: its reasoning, marked as
   * ended or cut short, and what the provider said of the request.
   */
  async #keepRound(
    taskId: string,
    answered: RoundResult,
    incomplete: boolean,
  ): Promise<void> {
    const {
      text: roundText,
      reasoning: roundReasoning,
      response: modelResponse,
      assistantId,
      assistantSequence,
    } = answered;
    if (roundReasoning && assistantSequence !== undefined) {
      await this.#records.progress.assistant(
        taskId,
        assistantId,
        roundText,
        assistantSequence,
        {
          text: roundReasoning,
          status: incomplete ? "interrupted" : "complete",
        },
      );
    }
    if (modelResponse) {
      const task = this.#records.task(taskId);
      await this.#records.replaceTask({
        ...task,
        modelResponses: [
          ...task.modelResponses,
          {
            ...modelResponse,
            complete: modelResponse.complete && !incomplete,
          },
        ],
      });
    }
  }

  #ownsTurn(taskId: string, controller: AbortController): boolean {
    return this.#ownership.owns(taskId, controller);
  }

  async #interruptIfCurrent(
    taskId: string,
    controller: AbortController,
    reason?: string,
  ): Promise<void> {
    if (this.#ownership.owns(taskId, controller)) {
      await this.#records.interrupt(taskId, reason);
    }
  }

  #openHistory(taskId: string): Promise<ModelHistory> {
    return openTaskHistory(this.#deps, this.#records, taskId);
  }
}
