/**
 * The tool-calling round loop a turn runs, from gathering what it can call
 * through repeating rounds until it has nothing left to say. Shared between a
 * turn a person just started and one woken automatically to receive a
 * background specialist's handoff — the two differ only in what happens
 * before this begins (a fresh user message and a plan, or nothing).
 */

import type { ProducedImage, WorkspaceDescription } from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { QuietFailures } from "./quiet-failures.js";
import { LoopGuard } from "./loop-guard.js";
import { PlanProgress } from "./plan-progress.js";
import { PlanJudge } from "./plan-judge.js";
import { StandingInstructions } from "./standing-instructions.js";
import {
  fitPictures,
  pictureCaption,
  picturesNotSent,
  type FittedPictures,
} from "./turn-pictures.js";
import {
  fixedModelMessages,
  specialistRunsText,
} from "./conversation-context.js";
import { harnessNotice, toolOutput } from "./notices.js";
import type { ModelHistory, SentPicture } from "./model-history.js";
import { ModelRound } from "./model-round.js";
import { RoundResults, resultLimits } from "./result-size.js";
import type { ContextGuard } from "./context-guard.js";
import { advertisedTools, openTaskHistory } from "./request-plan.js";
import { ToolCalls } from "./tool-calls.js";
import {
  delegateSpecialistToolName,
  SpecialistExecution,
} from "./specialist-execution.js";
import { deliverPendingHandoffs } from "./specialist-handoff-delivery.js";
import { activatePluginTool, PluginActivation } from "./plugin-activation.js";
import { PendingHandoffs } from "./pending-handoffs.js";
import { TurnRecords } from "./turn-records.js";
import { TurnWaits } from "./turn-waits.js";
import { answerDeclinedCall } from "./declined-call.js";
import { TurnOwnership } from "./turn-ownership.js";
import { deliverGuidance } from "./turn-guidance.js";
import { completionPhase } from "./turn-completion.js";
import {
  answerableCalls,
  describedWorkspace,
  maximumQuietRetries,
  modelFailure,
  namelessCallFailure,
  noLongerFits,
  pauseReportInstruction,
  protocolCall,
  refusedAsTooLong,
} from "./turn-shared.js";
import type { WorkLedger } from "./work-limits.js";
import type { AgentLoopDependencies } from "./dependencies.js";

export class TurnLoop {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  readonly #waits: TurnWaits;
  readonly #toolCalls: ToolCalls;
  readonly #specialists: SpecialistExecution;
  readonly #pluginActivation: PluginActivation;
  readonly #ownership: TurnOwnership;
  readonly #pendingHandoffs: PendingHandoffs;
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
    this.#round = new ModelRound(deps, parts.records);
    this.#context = parts.context;
    this.#plan = new PlanProgress(
      parts.records,
      new PlanJudge(deps, parts.records, (id) =>
        parts.context.targetTokens(id),
      ),
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
    const assistantParts: string[] = [];
    try {
      const workspace = await describedWorkspace(this.#deps.workspace);
      controller.signal.throwIfAborted();
      if (options?.beforeGather) await options.beforeGather(workspace);
      controller.signal.throwIfAborted();
      this.#deps.host.watchBrowser(taskId);
      let activatedPlugins = this.#records.task(taskId).activatedPlugins ?? [];
      const gathered = await this.#deps.capabilities.toolsFor(taskId, {
        skills: this.#deps.host.capabilitiesAvailable(),
        activatedPlugins,
      });
      if (!gathered.ok) throw new VisibleError(gathered.reason);
      let {
        tools: availableTools,
        skills,
        specialists,
        pluginDirectory,
        ownerOf: toolOwner,
      } = gathered.value;
      const currentAdvertisedTools = () =>
        advertisedTools({
          tools: availableTools,
          specialists,
          pluginDirectory,
        });
      const fixedMessages = fixedModelMessages(
        workspace,
        skills,
        pluginDirectory,
        this.#deps.now(),
      );
      let history = await this.#openHistory(taskId);
      const requestMessages = (): ModelMessage[] => [
        ...fixedMessages,
        ...history.messages(),
      ];

      const quiet = new QuietFailures();
      const guard = new LoopGuard();
      const standing = await this.#instructions.gather(
        taskId,
        controller.signal,
      );
      this.#plan.begin(taskId, () => availableTools, controller.signal);

      let reportOnly = false;
      let delegatedChildren = options?.initialDelegatedChildren ?? 0;
      /** The provider refused this step as too long, and it was condensed. */
      let refused = false;
      while (true) {
        await this.#plan.remind(taskId, history);
        await standing.send(history);
        const runs = specialistRunsText(
          this.#records.task(taskId).specialistRuns ?? [],
        );
        if (
          runs &&
          history.latestNotice("specialists") !==
            harnessNotice("specialists", runs)
        )
          await history.notice("specialists", runs);
        await deliverPendingHandoffs(
          taskId,
          this.#pendingHandoffs,
          this.#records,
          this.#deps.sessions,
          history,
        );
        if (await deliverGuidance(taskId, this.#records, history))
          guard.reset();
        const plan = {
          fixed: fixedMessages,
          tools: reportOnly ? [] : currentAdvertisedTools(),
        };
        history = await this.#context.prepare(
          taskId,
          history,
          plan,
          () => this.#openHistory(taskId),
          controller.signal,
        );
        controller.signal.throwIfAborted();
        const messages = requestMessages();
        const request = {
          messages,
          tools: plan.tools,
          ...(this.#records.task(taskId).reasoning
            ? { reasoning: this.#records.task(taskId).reasoning }
            : {}),
          session: taskId,
          cacheAfter: this.#cacheAfter(
            taskId,
            fixedMessages.length,
            messages.length,
          ),
        };
        const shown = this.#records.task(taskId).messages.length;
        const answered = await this.#round
          .run(taskId, controller, ledger, request, () =>
            this.#ownsTurn(taskId, controller),
          )
          .catch((error: unknown) => {
            // Recovered once per step, and only before any of an answer showed.
            const said = refusedAsTooLong(error);
            if (!said || this.#records.task(taskId).messages.length !== shown)
              throw error;
            if (refused) throw new VisibleError(noLongerFits);
            this.#context.refused(taskId, said);
            return undefined;
          });
        if (!answered) {
          refused = true;
          continue;
        }
        refused = false;
        const {
          calls,
          text: roundText,
          reasoning: roundReasoning,
          finishReason,
          response: modelResponse,
          usage,
          assistantId,
          assistantSequence,
        } = answered;
        this.#context.counted(
          taskId,
          plan,
          messages.slice(fixedMessages.length),
          usage,
        );

        if (controller.signal.aborted) {
          await this.#interruptIfCurrent(taskId, controller);
          return;
        }

        const incomplete =
          finishReason === "length" ||
          modelResponse?.complete === false ||
          (calls.length === 0 && !roundText.trim() && Boolean(roundReasoning));

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
              ...(task.modelResponses ?? []),
              {
                ...modelResponse,
                complete: modelResponse.complete && !incomplete,
              },
            ],
          });
        }
        if (roundText.trim()) assistantParts.push(roundText);
        if (reportOnly && calls.length > 0)
          return this.#records.finishPausedReport(
            taskId,
            assistantParts.join("\n\n"),
          );
        if (calls.length === 0) {
          if (
            this.#records
              .task(taskId)
              .guidance?.some((item) => item.status === "pending")
          ) {
            history = await this.#openHistory(taskId);
          }
          if (await deliverGuidance(taskId, this.#records, history)) {
            guard.reset();
            continue;
          }
          const assistantText = assistantParts.join("\n\n");
          if (!incomplete && !reportOnly)
            await this.#plan.settle(taskId, assistantText);
          controller.signal.throwIfAborted();
          const task = this.#records.task(taskId);
          await this.#records.replaceTask({
            ...task,
            phase: completionPhase(
              task,
              assistantText,
              reportOnly,
              incomplete,
              finishReason === "length",
            ),
          });
          return;
        }
        let renewed = false;
        const reached = ledger.reached(this.#deps.now());
        if (reached.length) {
          const decision = await this.#waits.waitForWorkBudget(
            taskId,
            ledger.completedToolRounds(),
            controller.signal,
            guard.reason(),
          );
          if (decision === "cancelled") {
            await this.#interruptIfCurrent(taskId, controller);
            return;
          }
          await this.#records.showWorking(
            taskId,
            undefined,
            this.#records.visibleSteps(taskId),
          );
          if (decision === "pause") {
            assistantParts.length = 0;
            await history.notice("pause", pauseReportInstruction);
            reportOnly = true;
            continue;
          }

          ledger.renew(this.#deps.now());
          renewed = true;
        }

        const { answerable, nameless } = answerableCalls(
          calls,
          () => `call-${this.#deps.newMessageId()}`,
        );
        history.round(
          roundText,
          answerable.map(protocolCall),
          this.#records
            .task(taskId)
            .messages.some((message) => message.id === assistantId)
            ? assistantId
            : undefined,
        );
        const round = {
          text: roundText,
          reasoning: roundReasoning,
          get messages() {
            return requestMessages();
          },
          tools: currentAdvertisedTools(),
        };
        const sizes = new RoundResults(
          (text) => this.#deps.sessions.keep("output", taskId, { text }),
          resultLimits(this.#context.targetTokens(taskId)),
        );

        let declinedInBatch = false;
        for (const call of answerable) {
          if (declinedInBatch) {
            await answerDeclinedCall(taskId, call, this.#plan, history);
            continue;
          }
          const quietRetriesLeft =
            maximumQuietRetries - quiet.attempts(call.name);
          const input = await this.#toolCalls.readInput(
            taskId,
            call,
            round,
            quietRetriesLeft,
            controller.signal,
          );
          await history.rewriteCall(call.callId, call.arguments);
          if (!input.ok) {
            await history.result(
              call,
              toolOutput(call.name, JSON.stringify(input.result)),
              Boolean(input.quiet),
            );
            if (input.quiet) quiet.remember(call.name, call.callId);
            continue;
          }
          const own = await this.#plan.take(taskId, call, input);
          const { args: parsed, said, note } = own;
          if (own.answered) {
            const answer = JSON.stringify({ ...own.answered, ...note });
            await history.result(call, toolOutput(call.name, answer), false);
            continue;
          }
          if (call.name === delegateSpecialistToolName) {
            const delegation = await this.#specialists.delegate({
              taskId,
              parentTurnId: taskId,
              parsedArguments: parsed,
              specialists,
              delegatedChildren,
              tools: availableTools,
              ownerOf: toolOwner,
              fixedMessages,
              workspace,
              ledger,
            });
            delegatedChildren = delegation.delegatedChildren;
            const handedBack = JSON.stringify({
              ...delegation.result,
              ...note,
            });
            this.#plan.answered(taskId, call.callId, handedBack);
            await history.result(
              call,
              toolOutput(call.name, handedBack),
              false,
            );
            if (controller.signal.aborted) {
              await this.#interruptIfCurrent(taskId, controller);
              return;
            }
            continue;
          }
          if (call.name === activatePluginTool.name) {
            const activation = await this.#pluginActivation.activate({
              taskId,
              call,
              parsedArguments: parsed,
              pluginDirectory,
              activatedPlugins,
              tools: availableTools,
              skills,
              specialists,
              ownerOf: toolOwner,
            });
            activatedPlugins = activation.activatedPlugins;
            availableTools = activation.tools;
            skills = activation.skills;
            specialists = activation.specialists;
            pluginDirectory = activation.pluginDirectory;
            toolOwner = activation.ownerOf;
            await history.result(
              call,
              toolOutput(
                call.name,
                JSON.stringify({ ...activation.result, ...note }),
              ),
              false,
            );
            if (controller.signal.aborted) {
              await this.#interruptIfCurrent(taskId, controller);
              return;
            }
            continue;
          }
          const owner = toolOwner(call.name);
          const outcome = await this.#toolCalls.runToolCall(
            taskId,
            call,
            parsed,
            owner,
            controller,
            quietRetriesLeft,
            round,
            said,
          );
          if (outcome.denied) declinedInBatch = true;
          guard.observe(call.name, parsed, outcome);
          if (controller.signal.aborted) {
            await this.#interruptIfCurrent(taskId, controller);
            return;
          }
          const produced = outcome.result.ok
            ? (outcome.result.images ?? [])
            : [];
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
          const sent = await sizes.fit(JSON.stringify(answered), answered);
          this.#plan.answered(taskId, call.callId, sent);
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
        await history.endRound();
        await guard.tell(history);
        if (renewed)
          await history.notice(
            "renewal",
            [
              "The person chose Continue at the renewable work-budget boundary.",
              `A fresh budget of ${ledger.maximumToolRounds()} tool rounds is available for the same task.`,
              "Continue from where the conversation stands.",
            ].join("\n"),
          );
        if (nameless) throw new VisibleError(namelessCallFailure);
        ledger.completeToolRound();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        await this.#interruptIfCurrent(taskId, controller);
        return;
      }
      const task = this.#records.task(taskId);
      await this.#records.replaceTask({
        ...task,
        phase: {
          kind: "failed",
          reason:
            modelFailure(error)?.message ??
            (error instanceof VisibleError
              ? error.message
              : "The model request failed. Try again."),
        },
      });
    } finally {
      if (this.#ownership.finish(taskId, controller)) {
        await this.#records.releaseGuidance(taskId);
        this.#records.forgetProgress(taskId);
      }
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

  /**
   * Where a later request is expected to repeat this one: after the fixed
   * start, after the previous request, and after the newest message.
   */
  #cacheAfter(taskId: string, fixed: number, length: number): number[] {
    const previous = this.#lastRequestLength.get(taskId);
    this.#lastRequestLength.set(taskId, length);
    return [
      ...new Set([
        fixed - 1,
        ...(previous === undefined ? [] : [previous - 1]),
        length - 1,
      ]),
    ]
      .filter((index) => index >= 0 && index < length)
      .sort((left, right) => left - right);
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
      this.#records.task(taskId).actions?.find((item) => item.id === actionId)
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
