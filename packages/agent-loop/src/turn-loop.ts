/**
 * The tool-calling round loop a turn runs, from gathering what it can call
 * through repeating rounds until it has nothing left to say. Shared between a
 * turn a person just started and one woken automatically to receive a
 * background specialist's handoff — the two differ only in what happens
 * before this begins (a fresh user message and a plan, or nothing).
 */

import type {
  ModelResponseRecord,
  ReasoningTrace,
  ToolSpec,
  WorkspaceDescription,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { ConversationTools } from "@zhiyin/capabilities";
import type { ModelMessage } from "@zhiyin/model-client";
import { QuietFailures } from "./quiet-failures.js";
import { fitPictures, picturesNotSent, sendPictures } from "./turn-pictures.js";
import {
  fixedModelMessages,
  modelFacingConversation,
  estimatedRequestTokens,
} from "./conversation-context.js";
import { AuxiliaryWork } from "./auxiliary-work.js";
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
  type AssembledToolCall,
  describedWorkspace,
  maximumQuietRetries,
  modelFailure,
  parsedArguments,
  pauseReportInstruction,
  protocolCall,
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
            role: "system",
            content: handoffMessage(settled),
          });
        }
        const assembled = new Map<number, AssembledToolCall>();
        let finishReason: string | undefined;
        let modelResponse: ModelResponseRecord | undefined;
        let roundText = "";
        let roundReasoning = "";
        let reasoningStatus: ReasoningTrace["status"] = "streaming";
        let assistantSequence: number | undefined;
        const assistantId = this.#deps.newMessageId();
        let reportedUsage = false;
        /**
         * When this round last said it was composing a call. Zero so the first
         * fragment always says so at once: the whole complaint is that nothing
         * happens for a while, and a delay before admitting to a delay is the
         * same silence with extra steps. After that it is paced, because the
         * note only has to stay true, not keep up with the tokens.
         */
        let composingSaidAt = 0;
        const composingIntervalMs = 250;
        const request = {
          messages: requestMessages,
          tools: reportOnly ? [] : currentAdvertisedTools(),
          ...(this.#records.task(taskId).reasoning
            ? { reasoning: this.#records.task(taskId).reasoning }
            : {}),
          signal: controller.signal,
        };

        for await (const event of this.#deps.model.send(request)) {
          if (!this.#ownsTurn(taskId, controller)) break;
          if (event.kind === "reasoningDelta") {
            roundReasoning += event.text;
            reasoningStatus = "streaming";
            assistantSequence ??= this.#records.nextTimelineSequence(
              this.#records.task(taskId),
            );
            await this.#records.showAssistantProgress(
              taskId,
              assistantId,
              roundText,
              assistantSequence,
              { text: roundReasoning, status: reasoningStatus },
            );
          } else if (event.kind === "textDelta") {
            roundText += event.text;
            if (event.text) reasoningStatus = "complete";
            assistantSequence ??= this.#records.nextTimelineSequence(
              this.#records.task(taskId),
            );
            await this.#records.showAssistantProgress(
              taskId,
              assistantId,
              roundText,
              assistantSequence,
              ...(roundReasoning
                ? [{ text: roundReasoning, status: reasoningStatus }]
                : []),
            );
          } else if (event.kind === "toolCallDelta") {
            const current = assembled.get(event.index) ?? {
              index: event.index,
              callId: "",
              name: "",
              arguments: "",
            };
            if (event.callId) current.callId = event.callId;
            if (event.name) current.name += event.name;
            if (event.argumentsDelta) current.arguments += event.argumentsDelta;
            assembled.set(event.index, current);
            const saidAgo = Date.now() - composingSaidAt;
            if (saidAgo >= composingIntervalMs) {
              composingSaidAt = Date.now();
              await this.#records.showWorking(
                taskId,
                current.name
                  ? `Composing a request: ${this.#records.humanizeIdentifier(current.name)}`
                  : "Composing a request",
                this.#records.visibleSteps(taskId),
              );
            }
          } else if (event.kind === "usage") {
            reportedUsage = true;
            ledger.record(event.usage);
            await this.#deps.host.recordUsage(event.usage);
          } else if (event.kind === "done") {
            finishReason = event.finishReason;
            modelResponse = event.response;
          }
        }

        if (!reportedUsage)
          ledger.estimate(
            estimatedRequestTokens(
              [
                ...request.messages,
                {
                  role: "assistant",
                  content: `${roundReasoning}\n${roundText}`,
                },
              ],
              request.tools,
            ),
          );

        if (controller.signal.aborted) {
          await this.#interruptIfCurrent(taskId, controller);
          return;
        }

        const calls = [...assembled.values()].sort(
          (left, right) => left.index - right.index,
        );
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
              role: "system",
              content: pauseReportInstruction,
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
              role: "system",
              content: [
                "The person chose Continue at the renewable work-budget boundary.",
                `A fresh budget of ${ledger.maximumToolRounds()} tool rounds is available for the same task.`,
                "Continue from the durable conversation and action evidence. Re-read a source when the retained evidence is insufficient.",
              ].join("\n"),
            },
          );
          includeRoundTextInProtocol = false;
        }

        const protocolCalls = calls.map((call) => protocolCall(call));
        requestMessages.push({
          role: "assistant",
          content: includeRoundTextInProtocol ? roundText : "",
          toolCalls: protocolCalls,
        });

        for (const call of calls) {
          let parsed: unknown;
          try {
            parsed = parsedArguments(call);
          } catch (error) {
            await this.#toolCalls.recordFailedProposal(
              taskId,
              call,
              "The requested action used invalid input.",
              "The model returned invalid input for a requested action.",
              controller.signal,
            );
            throw error;
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
              content: JSON.stringify(delegation.result),
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
              content: JSON.stringify(activation.result),
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
            maximumQuietRetries - quiet.attempts(call.name),
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
            content: JSON.stringify({
              ...outcome.result,
              images: undefined,
              ...(shown ? { picturesNotSent: shown } : {}),
            }),
          });
          if (fitted.pictures.length && this.#deps.host.acceptsImages())
            sendPictures(requestMessages, call.name, fitted);
          if (outcome.repairedArguments) {
            for (const [index, message] of requestMessages.entries()) {
              if (message.role !== "assistant" || !message.toolCalls) continue;
              if (!message.toolCalls.some((item) => item.id === call.callId))
                continue;
              requestMessages[index] = {
                ...message,
                toolCalls: message.toolCalls.map((item) =>
                  item.id === call.callId
                    ? {
                        ...item,
                        arguments: outcome.repairedArguments as string,
                      }
                    : item,
                ),
              };
            }
          }
          if (outcome.quiet) quiet.remember(call.name, call.callId);
          else if (outcome.result.ok) quiet.forget(call.name, requestMessages);
        }
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
