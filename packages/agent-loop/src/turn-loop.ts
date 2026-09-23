/**
 * The tool-calling round loop a turn runs, from gathering what it can call
 * through repeating rounds until it has nothing left to say. Shared between a
 * turn a person just started and one woken automatically to receive a
 * background specialist's handoff — the two differ only in what happens
 * before this begins (a fresh user message and a plan, or nothing).
 */

import type { ToolSpec, WorkspaceDescription } from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { ConversationTools } from "@zhiyin/capabilities";
import type { ModelMessage } from "@zhiyin/model-client";
import { QuietFailures } from "./quiet-failures.js";
import { fitPictures, picturesNotSent, sendPictures } from "./turn-pictures.js";
import {
  fixedModelMessages,
  modelFacingConversation,
} from "./conversation-context.js";
import { harnessNotice, toolOutput } from "./notices.js";
import { AuxiliaryWork } from "./auxiliary-work.js";
import { ModelRound } from "./model-round.js";
import { ToolCalls } from "./tool-calls.js";
import {
  delegateSpecialistTool,
  delegateSpecialistToolName,
  handoffMessage,
  SpecialistExecution,
} from "./specialist-execution.js";
import { activatePluginTool, PluginActivation } from "./plugin-activation.js";
import { PendingHandoffs } from "./pending-handoffs.js";
import { TurnRecords } from "./turn-records.js";
import { TurnWaits } from "./turn-waits.js";
import { TurnOwnership } from "./turn-ownership.js";
import {
  answerableCalls,
  describedWorkspace,
  maximumQuietRetries,
  modelFailure,
  namelessCallFailure,
  pauseReportInstruction,
  protocolCall,
  rewriteCallArguments,
} from "./turn-shared.js";
import type { WorkLedger } from "./work-limits.js";
import type { AgentLoopDependencies } from "./dependencies.js";

export class TurnLoop {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  readonly #auxiliary: AuxiliaryWork;
  readonly #waits: TurnWaits;
  readonly #toolCalls: ToolCalls;
  readonly #specialists: SpecialistExecution;
  readonly #pluginActivation: PluginActivation;
  readonly #ownership: TurnOwnership;
  readonly #pendingHandoffs: PendingHandoffs;
  readonly #round: ModelRound;

  constructor(
    deps: AgentLoopDependencies,
    parts: {
      readonly records: TurnRecords;
      readonly auxiliary: AuxiliaryWork;
      readonly waits: TurnWaits;
      readonly toolCalls: ToolCalls;
      readonly specialists: SpecialistExecution;
      readonly pluginActivation: PluginActivation;
      readonly ownership: TurnOwnership;
      readonly pendingHandoffs: PendingHandoffs;
    },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
    this.#auxiliary = parts.auxiliary;
    this.#waits = parts.waits;
    this.#toolCalls = parts.toolCalls;
    this.#specialists = parts.specialists;
    this.#pluginActivation = parts.pluginActivation;
    this.#ownership = parts.ownership;
    this.#pendingHandoffs = parts.pendingHandoffs;
    this.#round = new ModelRound(deps, parts.records);
  }

  async run(
    taskId: string,
    controller: AbortController,
    ledger: WorkLedger,
    options?: {
      readonly beforeGather?: (
        workspace: WorkspaceDescription,
      ) => Promise<void>;
      /**
       * How many specialists this task has already delegated to, carried
       * forward across a wake so the width bound holds for the conceptual
       * unit of work that started them — not reset just because a
       * background specialist outlived the turn that requested it. A fresh
       * turn a person starts leaves this unset, and gets the full bound.
       */
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
      const currentAdvertisedTools = (): readonly ToolSpec[] => [
        ...availableTools,
        ...(specialists.length ? [delegateSpecialistTool(specialists)] : []),
        ...(pluginDirectory.some((entry) => !entry.activated)
          ? [activatePluginTool]
          : []),
      ];
      const fixedMessages = this.#fixedModelMessages(
        this.#records.task(taskId),
        workspace,
        skills,
        pluginDirectory,
      );
      await this.#auxiliary.compactIfNeeded(
        taskId,
        fixedMessages,
        currentAdvertisedTools(),
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const requestMessages: ModelMessage[] = [
        ...this.#fixedModelMessages(
          this.#records.task(taskId),
          workspace,
          skills,
          pluginDirectory,
        ),
        ...modelFacingConversation(this.#records.task(taskId)),
      ];

      const quiet = new QuietFailures();

      let reportOnly = false;
      let delegatedChildren = options?.initialDelegatedChildren ?? 0;
      while (true) {
        for (const settled of this.#pendingHandoffs.drain(taskId)) {
          requestMessages.push({
            role: "user",
            content: harnessNotice("handoff", handoffMessage(settled)),
          });
        }
        const request = {
          messages: requestMessages,
          tools: reportOnly ? [] : currentAdvertisedTools(),
          ...(this.#records.task(taskId).reasoning
            ? { reasoning: this.#records.task(taskId).reasoning }
            : {}),
        };
        const {
          calls,
          text: roundText,
          reasoning: roundReasoning,
          finishReason,
          response: modelResponse,
          assistantId,
          assistantSequence,
        } = await this.#round.run(taskId, controller, ledger, request, () =>
          this.#ownsTurn(taskId, controller),
        );

        if (controller.signal.aborted) {
          await this.#interruptIfCurrent(taskId, controller);
          return;
        }

        const stoppedWithoutOutput =
          calls.length === 0 && !roundText.trim() && Boolean(roundReasoning);
        const incomplete =
          finishReason === "length" ||
          modelResponse?.complete === false ||
          stoppedWithoutOutput;

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
        if (reportOnly && calls.length > 0) {
          const assistantText = assistantParts.join("\n\n");
          const task = this.#records.task(taskId);
          await this.#records.replaceTask({
            ...task,
            phase: assistantText.trim()
              ? {
                  kind: "completed",
                  outcome: {
                    title: "Work paused",
                    summary: assistantText,
                  },
                }
              : {
                  kind: "interrupted",
                  reason:
                    "Work paused, but the model did not return the requested progress report.",
                },
          });
          return;
        }
        if (calls.length === 0) {
          const assistantText = assistantParts.join("\n\n");
          if (!incomplete && !reportOnly)
            await this.#auxiliary.evaluateRemainingCriteria(
              taskId,
              assistantText,
              controller.signal,
            );
          controller.signal.throwIfAborted();
          const task = this.#records.task(taskId);
          const backgroundSpecialistIds = (task.specialistRuns ?? [])
            .filter((run) => run.status === "running")
            .map((run) => run.id);
          // An answer that ran out of room is not an answer. Presenting it as
          // complete would hand someone a document that stops mid-sentence
          // and call it finished; what they need to know is that there is
          // more to come and that asking again continues it.
          await this.#records.replaceTask({
            ...task,
            phase: incomplete
              ? {
                  kind: "interrupted",
                  reason:
                    finishReason === "length"
                      ? "The answer was cut off before it was finished. Ask again to carry on from here."
                      : "The model stopped before returning an answer or action. Ask again to continue.",
                }
              : {
                  kind: "completed",
                  outcome: {
                    title: reportOnly ? "Work paused" : "Response complete",
                    summary: assistantText || "The model returned no text.",
                  },
                  ...(backgroundSpecialistIds.length
                    ? { backgroundSpecialistIds }
                    : {}),
                },
          });
          return;
        }
        let includeRoundTextInProtocol = true;
        const reached = ledger.reached(this.#deps.now());
        if (reached.length) {
          const decision = await this.#waits.waitForWorkBudget(
            taskId,
            ledger.completedToolRounds(),
            controller.signal,
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
            requestMessages.push({
              role: "user",
              content: harnessNotice("pause", pauseReportInstruction),
            });
            reportOnly = true;
            continue;
          }

          ledger.renew(this.#deps.now());

          const refreshedFixedMessages = this.#fixedModelMessages(
            this.#records.task(taskId),
            workspace,
            skills,
            pluginDirectory,
          );
          await this.#auxiliary.compactIfNeeded(
            taskId,
            refreshedFixedMessages,
            currentAdvertisedTools(),
            controller.signal,
          );
          controller.signal.throwIfAborted();
          requestMessages.splice(
            0,
            requestMessages.length,
            ...this.#fixedModelMessages(
              this.#records.task(taskId),
              workspace,
              skills,
              pluginDirectory,
            ),
            ...modelFacingConversation(this.#records.task(taskId)),
            {
              role: "user",
              content: harnessNotice(
                "renewal",
                [
                  "The person chose Continue at the renewable work-budget boundary.",
                  `A fresh budget of ${ledger.maximumToolRounds()} tool rounds is available for the same task.`,
                  "Continue from the durable conversation and action evidence. Re-read a source when the retained evidence is insufficient.",
                ].join("\n"),
              ),
            },
          );
          includeRoundTextInProtocol = false;
        }

        const { answerable, nameless } = answerableCalls(
          calls,
          () => `call-${this.#deps.newMessageId()}`,
        );
        requestMessages.push({
          role: "assistant",
          content: includeRoundTextInProtocol ? roundText : "",
          toolCalls: answerable.map(protocolCall),
        });
        const round = {
          text: roundText,
          reasoning: roundReasoning,
          messages: requestMessages,
          tools: currentAdvertisedTools(),
        };

        for (const call of answerable) {
          const quietRetriesLeft =
            maximumQuietRetries - quiet.attempts(call.name);
          const input = await this.#toolCalls.readInput(
            taskId,
            call,
            round,
            quietRetriesLeft,
            controller.signal,
          );
          rewriteCallArguments(requestMessages, call);
          if (!input.ok) {
            requestMessages.push({
              role: "tool",
              toolCallId: call.callId,
              name: call.name,
              content: toolOutput(call.name, JSON.stringify(input.result)),
            });
            if (input.quiet) quiet.remember(call.name, call.callId);
            continue;
          }
          const parsed = input.arguments;
          const note = input.note ? { note: input.note } : {};
          if (call.name === delegateSpecialistToolName) {
            const delegation = await this.#specialists.delegate({
              taskId,
              parentTurnId: taskId,
              parsedArguments: parsed,
              specialists,
              delegatedChildren,
              tools: availableTools,
              ownerOf: toolOwner,
              fixedMessages: this.#fixedModelMessages(
                this.#records.task(taskId),
                workspace,
                skills,
                pluginDirectory,
              ),
              workspace,
              ledger,
            });
            delegatedChildren = delegation.delegatedChildren;
            requestMessages.push({
              role: "tool",
              toolCallId: call.callId,
              name: call.name,
              content: toolOutput(
                call.name,
                JSON.stringify({ ...delegation.result, ...note }),
              ),
            });
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
            requestMessages.push({
              role: "tool",
              toolCallId: call.callId,
              name: call.name,
              content: toolOutput(
                call.name,
                JSON.stringify({ ...activation.result, ...note }),
              ),
            });
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
          );
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
          requestMessages.push({
            role: "tool",
            toolCallId: call.callId,
            name: call.name,
            content: toolOutput(
              call.name,
              JSON.stringify({
                ...outcome.result,
                images: undefined,
                ...(shown ? { picturesNotSent: shown } : {}),
                ...note,
              }),
            ),
          });
          if (fitted.pictures.length && this.#deps.host.acceptsImages())
            sendPictures(requestMessages, call.name, fitted);
          rewriteCallArguments(requestMessages, call);
          if (outcome.quiet) quiet.remember(call.name, call.callId);
          else if (outcome.result.ok) quiet.forget(call.name, requestMessages);
        }
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

  #fixedModelMessages(
    task: ReturnType<TurnRecords["task"]>,
    workspace: WorkspaceDescription,
    skills: ConversationTools["skills"],
    pluginDirectory: ConversationTools["pluginDirectory"],
  ): readonly ModelMessage[] {
    return fixedModelMessages(
      workspace,
      skills,
      pluginDirectory,
      task.specialistRuns ?? [],
      this.#auxiliary.contextEvidence(task),
      this.#deps.now(),
    );
  }
}
