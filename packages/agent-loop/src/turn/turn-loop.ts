/**
 * The tool-calling round loop a turn runs, from gathering what it can call
 * through repeating rounds until it has nothing left to say. Shared between a
 * turn a person just started and one woken automatically for a background
 * specialist's handoff or a command that ended — the two differ only in what
 * happens before this begins (a fresh message from the person, or nothing).
 */

import type {
  ProducedImage,
  ToolOwner,
  WorkspaceDescription,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { QuietFailures } from "../tools/quiet-failures.js";
import { LoopGuard } from "./loop-guard.js";
import { PlanProgress } from "../plan/plan-progress.js";
import { StandingInstructions } from "../context/standing-instructions.js";
import {
  fitPictures,
  pictureCaption,
  picturesNotSent,
  withoutPictures,
  type FittedPictures,
} from "./turn-pictures.js";
import { toolOutput } from "./notices.js";
import { deliverBackgroundWork } from "./background-deliveries.js";
import type { ModelHistory, SentPicture } from "../context/model-history.js";
import {
  AnswerNow,
  ModelRound,
  SentNow,
  ThoughtTooLong,
  type RoundResult,
} from "./model-round.js";
import { RoundResults, resultLimits } from "../context/result-size.js";
import type { ContextGuard } from "../context/context-guard.js";
import { modelRoundRequest, openTaskHistory } from "../plan/request-plan.js";
import { ToolCalls } from "../tools/tool-calls.js";
import {
  delegateSpecialistToolName,
  SpecialistExecution,
} from "../specialist/specialist-execution.js";
import {
  activatePluginTool,
  PluginActivation,
} from "../tools/plugin-activation.js";
import { PendingHandoffs } from "../specialist/pending-handoffs.js";
import type { CommandEndings } from "../tools/command-endings.js";
import { TurnRecords, showsPrompt } from "./turn-records.js";
import { TurnWaits } from "./turn-waits.js";
import { answerDeclinedCall } from "../tools/declined-call.js";
import { TurnOwnership } from "./turn-ownership.js";
import { TurnOffering } from "./turn-offering.js";
import type { RoundEvidence } from "../tools/tool-repair.js";
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
  answerableCalls,
  describedWorkspace,
  maximumQuietRetries,
  namelessCallFailure,
  noLongerFits,
  TurnFailure,
  type AssembledToolCall,
  pauseReportInstruction,
  protocolCall,
  refusedAsTooLong,
} from "./turn-shared.js";
import { renewalNotice, type WorkLedger } from "./work-limits.js";
import type { AgentLoopDependencies } from "../dependencies.js";
import { gatherTools } from "../tools/tool-gathering.js";

/** What one run of the loop carries from round to round. */
type Turn = {
  readonly taskId: string;
  readonly controller: AbortController;
  readonly ledger: WorkLedger;
  readonly offering: TurnOffering;
  readonly standing: Awaited<ReturnType<StandingInstructions["gather"]>>;
  readonly quiet: QuietFailures;
  readonly guard: LoopGuard;
  /** What the turn has said, a part for each round that said something. */
  readonly said: string[];
  history: ModelHistory;
  /** The person paused the work: the model reports, and calls nothing. */
  reportOnly: boolean;
  delegatedChildren: number;
  /** The provider refused this step as too long, and it was condensed. */
  refused: boolean;
  /** One fresh round may resume from completed tools after retry exhaustion. */
  connectionRecoveries: number;
  /** This step's request was stopped for reasoning at length, and asked again. */
  overthought: boolean;
  /**
   * The person asked for the answer now: the turn's remaining requests go
   * without reasoning, where the model can be asked that.
   */
  answerNow: boolean;
};

export class TurnLoop {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  readonly #waits: TurnWaits;
  readonly #toolCalls: ToolCalls;
  readonly #specialists: SpecialistExecution;
  readonly #pluginActivation: PluginActivation;
  readonly #ownership: TurnOwnership;
  readonly #pendingHandoffs: PendingHandoffs;
  readonly #commandEndings: CommandEndings;
  readonly #round: ModelRound;
  readonly #context: ContextGuard;
  readonly #instructions: StandingInstructions;
  readonly #plan: PlanProgress;
  /** How long each conversation's last request was, to mark where the next repeats it. */
  readonly #lastRequestLength = new Map<string, number>();

  constructor(
    deps: AgentLoopDependencies,
    parts: {
      readonly records: TurnRecords;
      readonly waits: TurnWaits;
      readonly toolCalls: ToolCalls;
      readonly specialists: SpecialistExecution;
      readonly pluginActivation: PluginActivation;
      readonly ownership: TurnOwnership;
      readonly pendingHandoffs: PendingHandoffs;
      readonly commandEndings: CommandEndings;
      readonly context: ContextGuard;
    },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
    this.#waits = parts.waits;
    this.#instructions = new StandingInstructions(deps, parts);
    this.#toolCalls = parts.toolCalls;
    this.#specialists = parts.specialists;
    this.#pluginActivation = parts.pluginActivation;
    this.#ownership = parts.ownership;
    this.#pendingHandoffs = parts.pendingHandoffs;
    this.#commandEndings = parts.commandEndings;
    this.#round = new ModelRound(deps, parts.records);
    this.#context = parts.context;
    this.#plan = new PlanProgress(parts.records);
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
      readonly beforeGather?: (
        workspace: WorkspaceDescription,
      ) => Promise<void>;
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
        const incomplete =
          finishReason === "length" ||
          response?.complete === false ||
          (calls.length === 0 && !text.trim() && Boolean(reasoning));

        await this.#keepRound(taskId, answered, incomplete);
        if (text.trim()) turn.said.push(text);
        if (turn.reportOnly && calls.length > 0)
          return this.#records.finishPausedReport(
            taskId,
            turn.said.join("\n\n"),
          );
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
        phase: {
          kind: "failed",
          reason: turnFailureReason(error, ledger.completedToolRounds()),
          ...(remedies.length ? { remedies } : {}),
        },
      });
    } finally {
      if (this.#ownership.finish(taskId, controller)) {
        await this.#records.releaseGuidance(taskId);
        this.#records.forgetProgress(taskId);
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
    const workspace = await describedWorkspace(this.#deps.workspace);
    controller.signal.throwIfAborted();
    if (options?.beforeGather) await options.beforeGather(workspace);
    controller.signal.throwIfAborted();
    this.#deps.host.watchBrowser(taskId);
    const activatedPlugins = this.#records.task(taskId).activatedPlugins;
    const gathered = await gatherTools(
      this.#deps,
      this.#records,
      taskId,
      activatedPlugins,
    );
    if (!gathered.ok) throw new VisibleError(gathered.reason);
    const offering = new TurnOffering({
      workspace,
      startedAt: this.#deps.now(),
      gathered: gathered.value,
      activatedPlugins,
    });
    const history = await this.#openHistory(taskId);
    const standing = await this.#instructions.gather(taskId, controller.signal);
    this.#plan.begin(taskId, () => offering.offered());
    return {
      taskId,
      controller,
      ledger,
      offering,
      standing,
      quiet: new QuietFailures(),
      guard: new LoopGuard(),
      said: [],
      history,
      reportOnly: false,
      delegatedChildren: options?.initialDelegatedChildren ?? 0,
      refused: false,
      connectionRecoveries: 0,
      overthought: false,
      answerNow: false,
    };
  }

  /** The request as it stands: its fixed start, then the conversation so far. */
  #requestMessages(turn: Turn): ModelMessage[] {
    return [
      ...turn.offering.fixedMessages,
      ...(this.#deps.host.acceptsImages()
        ? turn.history.messages()
        : withoutPictures(turn.history.messages())),
    ];
  }

  /**
   * One request to the model, once everything due before it is in the
   * history: the plan's reminder, the standing instructions, background work
   * that ended and what the person said meanwhile, all brought to a size the
   * model takes. Nothing comes back from a round that failed and was recovered
   * from: the loop asks again.
   */
  async #ask(turn: Turn): Promise<RoundResult | undefined> {
    const { taskId, controller, ledger, offering } = turn;
    await this.#plan.remind(taskId, turn.history);
    await turn.standing.send(turn.history);
    await deliverBackgroundWork(taskId, turn.history, {
      records: this.#records,
      pendingHandoffs: this.#pendingHandoffs,
      commandEndings: this.#commandEndings,
      sessions: this.#deps.sessions,
    });
    if (await deliverGuidance(taskId, this.#records, turn.history))
      turn.guard.reset();
    const fixed = offering.fixedMessages;
    const plan = {
      fixed,
      tools: turn.reportOnly ? [] : offering.advertised(),
    };
    turn.history = await this.#context.prepare(
      taskId,
      turn.history,
      plan,
      () => this.#openHistory(taskId),
      controller.signal,
    );
    controller.signal.throwIfAborted();
    const messages = this.#requestMessages(turn);
    const planned = modelRoundRequest(
      this.#records.task(taskId),
      messages,
      plan.tools,
      fixed.length,
      this.#lastRequestLength,
    );
    const request =
      turn.answerNow && this.#deps.host.reasoningOptional()
        ? { ...planned, reasoning: { enabled: false } as const }
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
   * per step to decide, and one the person stopped, to have the answer now
   * or to have what they added read now.
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
   * A round that called nothing ends the turn, unless the person said
   * something meanwhile or the plan still has open items the model has not
   * been told of: then the loop asks again.
   */
  async #afterLastWords(
    turn: Turn,
    answered: RoundResult,
    incomplete: boolean,
  ): Promise<"resumed" | "ended"> {
    const { taskId, controller, guard, reportOnly } = turn;
    const { reasoning, replay, finishReason, assistantId } = answered;
    const answer = this.#records
      .task(taskId)
      .messages.find((message) => message.id === assistantId);
    if (answer)
      await turn.history.answer(answer, {
        reasoning,
        ...(replay ? { replay } : {}),
      });
    if (
      this.#records
        .task(taskId)
        .guidance.some((item) => item.status === "pending")
    ) {
      turn.history = await this.#openHistory(taskId);
    }
    if (await deliverGuidance(taskId, this.#records, turn.history)) {
      guard.reset();
      return "resumed";
    }
    if (
      !incomplete &&
      !reportOnly &&
      (await this.#plan.beforeFinishing(taskId, turn.history))
    ) {
      guard.reset();
      return "resumed";
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
    return "ended";
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
    await this.#records.showWorking(
      taskId,
      undefined,
      this.#records.visibleSteps(taskId),
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
   * the round. Once the person declines one, the rest are answered as not
   * run. Says when the turn was stopped meanwhile.
   */
  async #answerCalls(
    turn: Turn,
    answered: RoundResult,
    { renewed }: { readonly renewed: boolean },
  ): Promise<"answered" | "stopped"> {
    const { taskId, ledger, offering, quiet, guard, history } = turn;
    const { calls, text, reasoning, replay, assistantId } = answered;
    const { answerable, nameless } = answerableCalls(
      calls,
      () => `call-${this.#deps.newMessageId()}`,
    );
    history.round(
      text,
      answerable.map(protocolCall),
      this.#records
        .task(taskId)
        .messages.some((message) => message.id === assistantId)
        ? assistantId
        : undefined,
      {
        reasoning,
        ...(replay ? { replay } : {}),
      },
    );
    const requestMessages = () => this.#requestMessages(turn);
    const round = {
      text,
      reasoning,
      get messages() {
        return requestMessages();
      },
      tools: offering.offered(),
    };
    const sizes = new RoundResults(
      (text) => this.#deps.sessions.keep("output", taskId, { text }),
      resultLimits(this.#context.targetTokens(taskId)),
    );

    let declinedInBatch = false;
    const quietBefore = quiet.total();
    for (const call of answerable) {
      if (declinedInBatch) {
        await answerDeclinedCall(call, history);
        continue;
      }
      const result = await this.#answerCall(turn, call, { round, sizes });
      if (result === "stopped") return "stopped";
      if (result === "declined") declinedInBatch = true;
    }
    await history.endRound();
    await guard.tell(history);
    if (renewed) await history.notice("renewal", renewalNotice(ledger));
    if (nameless) throw new VisibleError(namelessCallFailure);
    // A round of nothing but quiet corrections is the model fixing its own
    // input, not work done, so it does not count toward the budget.
    if (quiet.total() - quietBefore < answerable.length) {
      ledger.completeToolRound();
      await this.#plan.afterRound(taskId, history);
    }
    return "answered";
  }

  /**
   * Answers one call: its input read, then the plan, a specialist or a plugin
   * where the call is the loop's own, and otherwise the tool that owns it.
   */
  async #answerCall(
    turn: Turn,
    call: AssembledToolCall,
    {
      round,
      sizes,
    }: { readonly round: RoundEvidence; readonly sizes: RoundResults },
  ): Promise<"answered" | "declined" | "stopped"> {
    const { taskId, controller, offering, quiet, guard, history } = turn;
    const quietRetriesLeft = maximumQuietRetries - quiet.attempts(call.name);
    const input = await this.#toolCalls.readInput(taskId, call, {
      round,
      quietRetriesLeft,
      signal: controller.signal,
    });
    await history.rewriteCall(call.callId, call.arguments);
    if (!input.ok) {
      await history.result(
        call,
        toolOutput(call.name, JSON.stringify(input.result)),
        Boolean(input.quiet),
      );
      if (input.quiet) quiet.remember(call.name, call.callId);
      return "answered";
    }
    const own = await this.#plan.take(taskId, call, input);
    const { args: parsed, said, note } = own;
    if (own.answered) {
      const answer = JSON.stringify({ ...own.answered, ...note });
      await history.result(call, toolOutput(call.name, answer), false);
      return "answered";
    }
    if (call.name === delegateSpecialistToolName)
      return this.#delegate(turn, call, parsed, note);
    if (call.name === activatePluginTool.name)
      return this.#activatePlugin(turn, call, parsed, note);
    const owner = offering.ownerOf(call.name);
    const outcome = await this.#toolCalls.runToolCall(taskId, call, {
      proposedArguments: parsed,
      owner,
      controller,
      quietRetriesLeft,
      round,
      said,
    });
    guard.observe(call.name, parsed, outcome);
    if (controller.signal.aborted) {
      await this.#interruptIfCurrent(taskId, controller);
      return "stopped";
    }
    await this.#tellModel(taskId, call, {
      outcome,
      parsed,
      note,
      owner,
      sizes,
      history,
      quiet,
    });
    return outcome.denied ? "declined" : "answered";
  }

  /** Hands a task to a specialist, and tells the model whether it was taken. */
  async #delegate(
    turn: Turn,
    call: AssembledToolCall,
    parsed: Record<string, unknown>,
    note: Record<string, unknown>,
  ): Promise<"answered" | "stopped"> {
    const { taskId, offering } = turn;
    const delegation = await this.#specialists.delegate({
      taskId,
      parentTurnId: taskId,
      parsedArguments: parsed,
      specialists: offering.specialists,
      delegatedChildren: turn.delegatedChildren,
      tools: offering.tools,
      ownerOf: offering.ownerOf,
      fixedMessages: offering.specialistStart(this.#deps.now()),
      workspace: offering.workspace,
    });
    turn.delegatedChildren = delegation.delegatedChildren;
    return this.#answerOwnCall(turn, call, { ...delegation.result, ...note });
  }

  /**
   * Activates a plugin for the rest of the conversation: what the turn offers
   * changes before the model is told, so its next request carries both.
   */
  async #activatePlugin(
    turn: Turn,
    call: AssembledToolCall,
    parsed: Record<string, unknown>,
    note: Record<string, unknown>,
  ): Promise<"answered" | "stopped"> {
    const { taskId, offering } = turn;
    const activation = await this.#pluginActivation.activate({
      taskId,
      call,
      parsedArguments: parsed,
      pluginDirectory: offering.pluginDirectory,
      activatedPlugins: offering.activatedPlugins,
      tools: offering.tools,
      skills: offering.skills,
      specialists: offering.specialists,
      ownerOf: offering.ownerOf,
    });
    offering.adopt(activation);
    return this.#answerOwnCall(turn, call, { ...activation.result, ...note });
  }

  /** Tells the model what a call the loop answered itself came to. */
  async #answerOwnCall(
    turn: Turn,
    call: AssembledToolCall,
    answer: Record<string, unknown>,
  ): Promise<"answered" | "stopped"> {
    const { taskId, controller } = turn;
    await turn.history.result(
      call,
      toolOutput(call.name, JSON.stringify(answer)),
      false,
    );
    if (controller.signal.aborted) {
      await this.#interruptIfCurrent(taskId, controller);
      return "stopped";
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
      await this.#records.showAssistantProgress(
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

  /**
   * Tells the model what a call that ran answered: the tool's answer without
   * the person's copy of it, cut to what the conversation can carry, and the
   * pictures it made, fitted to what the model accepts.
   */
  async #tellModel(
    taskId: string,
    call: AssembledToolCall,
    {
      outcome,
      parsed,
      note,
      owner,
      sizes,
      history,
      quiet,
    }: {
      readonly outcome: Awaited<ReturnType<ToolCalls["runToolCall"]>>;
      readonly parsed: Record<string, unknown>;
      readonly note: Record<string, unknown>;
      readonly owner: ToolOwner | undefined;
      readonly sizes: RoundResults;
      readonly history: ModelHistory;
      readonly quiet: QuietFailures;
    },
  ): Promise<void> {
    const produced = outcome.result.ok ? (outcome.result.images ?? []) : [];
    const fitted = await fitPictures(produced, this.#deps.pictures);
    if (fitted.notes.length && outcome.actionId)
      await this.#records.notePictureFitting(taskId, outcome.actionId, [
        ...fitted.notes,
      ]);
    const shown = picturesNotSent(
      produced,
      fitted,
      this.#deps.host.acceptsImages(),
    );
    // What the tool answered for the model; `details` is its copy for
    // the person, and is not sent again.
    const answered = {
      ...outcome.result,
      images: undefined,
      details: undefined,
      ...(shown ? { picturesNotSent: shown } : {}),
      ...note,
    };
    const sent = await sizes.fit(
      JSON.stringify(answered),
      answered,
      owner === "built-in" ? parsed : undefined,
    );
    await history.result(
      call,
      toolOutput(call.name, sent),
      Boolean(outcome.quiet),
    );
    if (fitted.pictures.length && this.#deps.host.acceptsImages())
      await history.pictures(
        pictureCaption(call.name, fitted),
        await this.#storedPictures(
          taskId,
          outcome.actionId,
          produced,
          fitted,
          owner === "mcp" ? "connector" : "tool",
        ),
      );
    await history.rewriteCall(call.callId, call.arguments);
    if (outcome.quiet) quiet.remember(call.name, call.callId);
    else if (outcome.result.ok) history.forget(quiet.take(call.name));
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

  /**
   * The pictures as sent, each with where it is stored. One the action already
   * stored unchanged is named by that; one made to fit is stored as sent.
   */
  async #storedPictures(
    taskId: string,
    actionId: string | undefined,
    produced: readonly ProducedImage[],
    fitted: FittedPictures,
    owner: "tool" | "connector",
  ): Promise<SentPicture[]> {
    const kept = (
      this.#records.task(taskId).actions.find((item) => item.id === actionId)
        ?.details ?? []
    ).flatMap((detail) => (detail.kind === "image" ? [detail.source] : []));
    return Promise.all(
      fitted.pictures.map(async (picture, index) => {
        const from = fitted.from[index] ?? -1;
        const source =
          kept.length === produced.length && picture === produced[from]
            ? kept[from]
            : await this.#deps.sessions
                .savePicture(taskId, picture, owner)
                .catch(() => "");
        return { ...picture, source: source ?? "" };
      }),
    );
  }
}
