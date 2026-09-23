/**
 * The tool-calling round loop a turn runs, from gathering what it can call
 * through repeating rounds until it has nothing left to say. Shared between a
 * turn a person just started and one woken automatically to receive a
 * background specialist's handoff — the two differ only in what happens
 * before this begins (a fresh user message and a plan, or nothing).
 */

import type {
  ProducedImage,
  ToolSpec,
  WorkspaceDescription,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { QuietFailures } from "./quiet-failures.js";
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
import { ModelHistory, type SentPicture } from "./model-history.js";
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
  /** How long each conversation's last request was, to mark where the next repeats it. */
  readonly #lastRequestLength = new Map<string, number>();

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
      const fixedMessages = fixedModelMessages(
        workspace,
        skills,
        pluginDirectory,
        this.#deps.now(),
      );
      let history = await this.#condensedIfNeeded(
        taskId,
        await this.#openHistory(taskId),
        fixedMessages,
        currentAdvertisedTools(),
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const requestMessages = (): ModelMessage[] => [
        ...fixedMessages,
        ...history.messages(),
      ];

      const quiet = new QuietFailures();

      let reportOnly = false;
      let delegatedChildren = options?.initialDelegatedChildren ?? 0;
      while (true) {
        const runs = specialistRunsText(
          this.#records.task(taskId).specialistRuns ?? [],
        );
        if (
          runs &&
          history.latestNotice("specialists") !==
            harnessNotice("specialists", runs)
        )
          await history.notice("specialists", runs);
        for (const settled of this.#pendingHandoffs.drain(taskId))
          await history.notice("handoff", handoffMessage(settled));
        const messages = requestMessages();
        const request = {
          messages,
          tools: reportOnly ? [] : currentAdvertisedTools(),
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
        let renewed = false;
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
            await history.notice("pause", pauseReportInstruction);
            reportOnly = true;
            continue;
          }

          ledger.renew(this.#deps.now());
          history = await this.#condensedIfNeeded(
            taskId,
            history,
            fixedMessages,
            currentAdvertisedTools(),
            controller.signal,
          );
          controller.signal.throwIfAborted();
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
              fixedMessages,
              workspace,
              ledger,
            });
            delegatedChildren = delegation.delegatedChildren;
            await history.result(
              call,
              toolOutput(
                call.name,
                JSON.stringify({ ...delegation.result, ...note }),
              ),
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
          await history.result(
            call,
            toolOutput(
              call.name,
              JSON.stringify({
                ...outcome.result,
                images: undefined,
                ...(shown ? { picturesNotSent: shown } : {}),
                ...note,
              }),
            ),
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
              ),
            );
          await history.rewriteCall(call.callId, call.arguments);
          if (outcome.quiet) quiet.remember(call.name, call.callId);
          else if (outcome.result.ok) history.forget(quiet.take(call.name));
        }
        await history.endRound();
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

  async #openHistory(taskId: string): Promise<ModelHistory> {
    return ModelHistory.open(this.#records.task(taskId), {
      newId: () => this.#deps.newMessageId(),
      readPicture: (source) => this.#deps.sessions.readPicture(source),
      save: async (modelHistory) => {
        await this.#records.replaceTask({
          ...this.#records.task(taskId),
          modelHistory,
        });
      },
    });
  }

  /** The history, reopened from its summary when it had to be condensed. */
  async #condensedIfNeeded(
    taskId: string,
    history: ModelHistory,
    fixedMessages: readonly ModelMessage[],
    tools: readonly ToolSpec[],
    signal: AbortSignal,
  ): Promise<ModelHistory> {
    const condensed = await this.#auxiliary.compactIfNeeded(
      taskId,
      [...fixedMessages, ...history.messages()],
      tools,
      signal,
    );
    return condensed ? this.#openHistory(taskId) : history;
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
            : await this.#deps.sessions.savePicture(picture).catch(() => "");
        return { ...picture, source: source ?? "" };
      }),
    );
  }
}
