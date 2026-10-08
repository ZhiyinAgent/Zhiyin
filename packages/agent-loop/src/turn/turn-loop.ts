/**
 * The tool-calling round loop a turn runs, from gathering what it can call
 * through repeating rounds until it has nothing left to say. Shared between a
 * turn a person just started and one woken automatically for a background
 * specialist's handoff or a command that ended — the two differ only in what
 * happens before this begins (a fresh message from the person, or nothing).
 */

import type { ProducedImage, WorkspaceDescription } from "@zhiyin/contract";
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
import { fixedModelMessages } from "../context/conversation-context.js";
import { toolOutput } from "./notices.js";
import { deliverBackgroundWork } from "./background-deliveries.js";
import type { ModelHistory, SentPicture } from "../context/model-history.js";
import { ModelRound } from "./model-round.js";
import { RoundResults, resultLimits } from "../context/result-size.js";
import type { ContextGuard } from "../context/context-guard.js";
import {
  advertisedTools,
  offeredTools,
  modelRoundRequest,
  openTaskHistory,
} from "../plan/request-plan.js";
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
import { TurnRecords } from "./turn-records.js";
import { TurnWaits } from "./turn-waits.js";
import { answerDeclinedCall } from "../tools/declined-call.js";
import { TurnOwnership } from "./turn-ownership.js";
import { deliverGuidance } from "./turn-guidance.js";
import { completionPhase } from "./turn-completion.js";
import {
  recoverConnectionFailure,
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
  pauseReportInstruction,
  protocolCall,
  refusedAsTooLong,
} from "./turn-shared.js";
import { renewalNotice, type WorkLedger } from "./work-limits.js";
import type { AgentLoopDependencies } from "../dependencies.js";
import { gatherTools } from "../tools/tool-gathering.js";

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
      let activatedPlugins = this.#records.task(taskId).activatedPlugins;
      const gathered = await gatherTools(
        this.#deps,
        this.#records,
        taskId,
        activatedPlugins,
      );
      if (!gathered.ok) throw new VisibleError(gathered.reason);
      let {
        tools: availableTools,
        skills,
        specialists,
        pluginDirectory,
        ownerOf: toolOwner,
      } = gathered.value;
      const offering = () => ({
        tools: availableTools,
        specialists,
        pluginDirectory,
      });
      const currentAdvertisedTools = () => advertisedTools(offering());
      // Rebuilt when a plugin is activated, so what the model is told about
      // plugins and skills changes in the same request as its tools: one new
      // start for the provider to cache, not one now and another next turn.
      const startedAt = this.#deps.now();
      const fixedStart = () =>
        fixedModelMessages(
          workspace,
          skills,
          pluginDirectory,
          startedAt,
          availableTools,
        );
      let fixedMessages = fixedStart();
      let history = await this.#openHistory(taskId);
      const requestMessages = (): ModelMessage[] => [
        ...fixedMessages,
        ...(this.#deps.host.acceptsImages()
          ? history.messages()
          : withoutPictures(history.messages())),
      ];

      const quiet = new QuietFailures();
      const guard = new LoopGuard();
      const standing = await this.#instructions.gather(
        taskId,
        controller.signal,
      );
      this.#plan.begin(taskId, () => offeredTools(offering()));

      let reportOnly = false;
      let delegatedChildren = options?.initialDelegatedChildren ?? 0;
      /** The provider refused this step as too long, and it was condensed. */
      let refused = false;
      /** One fresh round may resume from completed tools after retry exhaustion. */
      let connectionRecovery = 0;
      while (true) {
        await this.#plan.remind(taskId, history);
        await standing.send(history);
        await deliverBackgroundWork(taskId, history, {
          records: this.#records,
          pendingHandoffs: this.#pendingHandoffs,
          commandEndings: this.#commandEndings,
          sessions: this.#deps.sessions,
        });
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
        const request = modelRoundRequest(
          this.#records.task(taskId),
          messages,
          plan.tools,
          fixedMessages.length,
          this.#lastRequestLength,
        );
        const shown = this.#records.task(taskId).messages.length;
        let recovering = false;
        const answered = await this.#round
          .run(taskId, controller, ledger, request, () =>
            this.#ownsTurn(taskId, controller),
          )
          .catch(async (error: unknown) => {
            // A stopped turn stays stopped, whatever its cancelled request
            // looked like when it ended: nothing here may resume it.
            if (controller.signal.aborted) throw error;
            if (
              await recoverConnectionFailure({
                error,
                taskId,
                messagesBeforeRound: shown,
                previousRecoveries: connectionRecovery,
                records: this.#records,
                history,
                ledger,
              })
            ) {
              connectionRecovery += 1;
              recovering = true;
              return undefined;
            }
            // Recovered once per step, and only before any of an answer showed.
            const said = refusedAsTooLong(error);
            if (!said || this.#records.task(taskId).messages.length !== shown)
              throw error;
            if (refused)
              throw new TurnFailure(noLongerFits, [
                "chooseLargerModel",
                "tryAgain",
              ]);
            this.#context.refused(taskId, said);
            return undefined;
          });
        if (!answered) {
          if (!recovering) refused = true;
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
              ...task.modelResponses,
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
              .guidance.some((item) => item.status === "pending")
          ) {
            history = await this.#openHistory(taskId);
          }
          if (await deliverGuidance(taskId, this.#records, history)) {
            guard.reset();
            continue;
          }
          if (
            !incomplete &&
            !reportOnly &&
            (await this.#plan.beforeFinishing(taskId, history))
          ) {
            guard.reset();
            continue;
          }
          const assistantText = assistantParts.join("\n\n");
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
            ledger.checkpoint(this.#deps.now()),
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
        const quietBefore = quiet.total();
        for (const call of answerable) {
          if (declinedInBatch) {
            await answerDeclinedCall(call, history);
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
              fixedMessages: fixedModelMessages(
                workspace,
                skills,
                pluginDirectory,
                this.#deps.now(),
                availableTools,
                "specialist",
              ),
              workspace,
            });
            delegatedChildren = delegation.delegatedChildren;
            const handedBack = JSON.stringify({
              ...delegation.result,
              ...note,
            });
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
            fixedMessages = fixedStart();
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
      }
    } catch (error) {
      if (controller.signal.aborted) {
        await this.#interruptIfCurrent(taskId, controller);
        return;
      }
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
