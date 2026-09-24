/**
 * Runs a turn: send the conversation to a model, get each proposed action
 * decided by the permission engine, execute the approved ones, feed results
 * back, repeat until the turn ends. A turn may end while a delegated
 * specialist keeps running in the background; when that specialist settles,
 * this wakes the task with a fresh, automatic turn to receive it.
 *
 * This package owns the order of steps and nothing about how any step is
 * performed. If a change here needs to know which tool it is calling, which
 * MCP server is behind it, or what a skill contains, the change belongs in
 * that feature instead.
 *
 * Boundaries and invariants: docs/architecture/features/agent-loop/README.md
 */

import type {
  AppEvent,
  ReasoningSelection,
  WorkspaceTask,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import { AuxiliaryWork } from "./auxiliary-work.js";
import { ToolCalls } from "./tool-calls.js";
import { SpecialistExecution } from "./specialist-execution.js";
import type { SpecialistExecutionResult } from "./specialist-execution.js";
import { PluginActivation } from "./plugin-activation.js";
import { PendingHandoffs } from "./pending-handoffs.js";
import { TurnRecords } from "./turn-records.js";
import { TurnWaits } from "./turn-waits.js";
import { TurnOwnership } from "./turn-ownership.js";
export { TurnOwnership } from "./turn-ownership.js";
import { TurnLoop } from "./turn-loop.js";
import { ContextGuard } from "./context-guard.js";
import { condenseBetweenTurns } from "./request-plan.js";
import { beginUserTurn } from "./start-turn.js";
import { modelText } from "./attachments.js";
import { settledAfterRestart, settledWhenTurnEnded } from "./settling.js";
import { defaultWorkLimits, WorkLedger } from "./work-limits.js";
export { WorkLedger, type WorkLimits } from "./work-limits.js";
import type { AgentLoopDependencies } from "./dependencies.js";
export type { AgentLoopDependencies, TurnHost } from "./dependencies.js";

export class AgentLoop {
  readonly #deps: AgentLoopDependencies;
  readonly #activeTurns = new TurnOwnership();
  readonly #records: TurnRecords;
  readonly #auxiliary: AuxiliaryWork;
  readonly #waits: TurnWaits;
  readonly #toolCalls: ToolCalls;
  readonly #specialists: SpecialistExecution;
  readonly #pluginActivation: PluginActivation;
  readonly #pendingHandoffs = new PendingHandoffs();
  readonly #wakeScheduled = new Set<string>();
  readonly #turnLoop: TurnLoop;
  readonly #context: ContextGuard;
  /** A condensing the person asked for between turns, until it ends. */
  readonly #condensing = new Map<string, Promise<void>>();

  constructor(deps: AgentLoopDependencies) {
    this.#deps = deps;
    this.#records = new TurnRecords(deps, (task) => this.#storeGuard(task));
    this.#auxiliary = new AuxiliaryWork(deps, { records: this.#records });
    this.#waits = new TurnWaits(deps, { records: this.#records });
    this.#toolCalls = new ToolCalls(
      deps,
      {
        records: this.#records,
        auxiliary: this.#auxiliary,
        waits: this.#waits,
      },
      {
        interruptIfCurrent: (taskId, controller, reason) =>
          this.#interruptIfCurrent(taskId, controller, reason),
      },
    );
    this.#specialists = new SpecialistExecution(deps, {
      records: this.#records,
      toolCalls: this.#toolCalls,
      ownership: this.#activeTurns,
      onSettled: (taskId, result) => this.#deliverHandoff(taskId, result),
    });
    this.#pluginActivation = new PluginActivation(deps, {
      records: this.#records,
    });
    this.#context = new ContextGuard(deps, this.#records);
    this.#turnLoop = new TurnLoop(deps, {
      records: this.#records,
      auxiliary: this.#auxiliary,
      waits: this.#waits,
      toolCalls: this.#toolCalls,
      specialists: this.#specialists,
      pluginActivation: this.#pluginActivation,
      ownership: this.#activeTurns,
      pendingHandoffs: this.#pendingHandoffs,
      context: this.#context,
    });
  }

  /** Present so the composition is real rather than decorative. */
  emit(event: AppEvent): void {
    this.#deps.host.emit(event);
  }

  async start(
    taskId: string,
    userInput: string,
    reasoning?: ReasoningSelection,
    attachments: readonly string[] = [],
  ): Promise<void> {
    // A message sent while the conversation is being condensed goes out on
    // the condensed conversation.
    await this.#condensing.get(taskId);
    if (!this.#deps.host.historyAvailable())
      throw new VisibleError(
        "Saved history is unavailable. Retry after restoring access.",
      );
    if (this.#activeTurns.running(taskId))
      throw new VisibleError(
        "This task is already running. Stop it before starting another turn.",
      );
    if (this.#deps.rewind.restoring(taskId))
      throw new VisibleError(
        "Wait for file recovery to finish before starting another turn.",
      );
    const message = userInput.trim();
    if (!message && !attachments.length) return;
    if (!this.#deps.host.find(taskId))
      throw new Error("The task does not exist.");

    // Registered before the first await: everything between the
    // already-running check above and this point must stay synchronous, or two
    // starts can both pass it.
    const controller = this.#activeTurns.start(taskId);
    const ledger = new WorkLedger(
      this.#deps.workLimits ?? defaultWorkLimits,
      this.#deps.now(),
    );
    // Pastes kept as drafts move into this conversation as it is sent. One
    // that is gone is not sent as though it were there.
    const claimed = attachments.length
      ? await this.#deps.sessions
          .claimDrafts(taskId, attachments)
          .catch((error: unknown) => {
            this.#activeTurns.finish(taskId, controller);
            throw error;
          })
      : [];
    if (claimed.length < attachments.length) {
      this.#activeTurns.finish(taskId, controller);
      throw new VisibleError(
        "The pasted text is no longer available. Paste it again.",
      );
    }

    // A turn runs where its conversation lives, whatever the window last
    // displayed. A no-op when they already agree.
    await this.#deps.host.enterFolderOf(taskId);
    const existing = this.#records.task(taskId);
    const started = beginUserTurn(existing, message, {
      messageId: this.#deps.newMessageId(),
      sequence: this.#records.nextTimelineSequence(existing),
      attachments: claimed,
      ...(reasoning ? { reasoning } : {}),
    });
    await this.#records.replaceTask(started.task);

    await this.#turnLoop.run(taskId, controller, ledger, {
      beforeGather: (workspace) =>
        this.#auxiliary.createPlan(
          taskId,
          modelText({ text: message, attachments: claimed }),
          workspace,
          controller.signal,
          started.shouldGenerateInitialTitle,
        ),
    });
  }

  /**
   * Condenses the conversation because the person asked: at once when nothing
   * runs in it, else before the running turn's next request to the model.
   * Asked again while one runs, it waits for that one rather than queueing
   * another for the next message.
   */
  async condenseNow(taskId: string): Promise<void> {
    if (!this.#deps.host.historyAvailable())
      throw new VisibleError(
        "Saved history is unavailable. Retry after restoring access.",
      );
    if (!this.#deps.host.find(taskId))
      throw new Error("The task does not exist.");
    if (this.#deps.rewind.restoring(taskId))
      throw new VisibleError(
        "Wait for file recovery to finish before compacting.",
      );
    const pending = this.#condensing.get(taskId);
    if (pending) return pending;
    this.#context.ask(taskId);
    if (this.#activeTurns.running(taskId)) return;

    const controller = this.#activeTurns.start(taskId);
    const condensing = (async () => {
      try {
        await this.#deps.host.enterFolderOf(taskId);
        await condenseBetweenTurns(
          this.#deps,
          this.#records,
          this.#context,
          taskId,
          controller.signal,
        );
      } finally {
        this.#activeTurns.finish(taskId, controller);
      }
    })();
    this.#condensing.set(
      taskId,
      condensing.catch(() => {}).finally(() => this.#condensing.delete(taskId)),
    );
    await condensing;
  }

  /**
   * Automatically continues a task whose own turn already ended after a
   * background specialist it started settles. A no-op when a turn is already
   * live for the task — that turn's own round loop drains the same queue
   * itself — or when the task can no longer run one (deleted, or mid file
   * recovery).
   */
  async #resume(taskId: string): Promise<void> {
    if (this.#activeTurns.running(taskId)) return;
    if (this.#deps.rewind.restoring(taskId)) return;
    if (!this.#deps.host.find(taskId)) return;
    const controller = this.#activeTurns.start(taskId);
    const ledger = new WorkLedger(
      this.#deps.workLimits ?? defaultWorkLimits,
      this.#deps.now(),
    );
    await this.#deps.host.enterFolderOf(taskId);
    await this.#turnLoop.run(taskId, controller, ledger, {
      initialDelegatedChildren: (
        this.#records.task(taskId).specialistRuns ?? []
      ).length,
    });
  }

  /**
   * Queues a settled specialist's handoff for its task, and — only when no
   * turn is currently live to pick it up itself — wakes the task with a
   * fresh turn to deliver it. Deduplicated per task so several specialists
   * settling close together trigger at most one wake, which then drains
   * everything queued once it starts.
   */
  #deliverHandoff(taskId: string, result: SpecialistExecutionResult): void {
    this.#pendingHandoffs.push(taskId, result);
    if (this.#activeTurns.running(taskId)) return;
    if (this.#wakeScheduled.has(taskId)) return;
    this.#wakeScheduled.add(taskId);
    void this.#resume(taskId).finally(() => {
      this.#wakeScheduled.delete(taskId);
    });
  }

  /**
   * How a conversation found after a restart is settled: a turn does not
   * outlive the process that ran it. The same conversation comes back when
   * there was nothing to settle.
   */
  settleAfterRestart(task: WorkspaceTask): WorkspaceTask {
    return settledAfterRestart(task);
  }

  /** How a conversation's reasoning is settled once its turn has ended. */
  settleEndedTurn(task: WorkspaceTask): WorkspaceTask {
    return settledWhenTurnEnded(task);
  }

  async cancel(taskId: string): Promise<void> {
    this.#activeTurns.cancel(taskId);
    await this.#records.interrupt(taskId);
    await this.#deps.capabilities.closeConversation(taskId);
  }

  /** Whether a turn is running in this conversation, including a specialist
   * still finishing in the background after its own turn ended. */
  running(taskId: string): boolean {
    if (this.#activeTurns.running(taskId)) return true;
    const task = this.#deps.host.find(taskId);
    return (task?.specialistRuns ?? []).some((run) => run.status === "running");
  }

  /** Whether any turn is running, not counting the one named. */
  anyRunning(exceptTaskId?: string): boolean {
    return this.#activeTurns.anyRunning(exceptTaskId);
  }

  /**
   * Whether a write to this conversation is still accepted. A turn that was
   * stopped owns nothing, so nothing but the record of its stopping is written
   * for its conversation.
   */
  accepts(task: WorkspaceTask): boolean {
    return !(
      this.#activeTurns.controller(task.id)?.signal.aborted &&
      task.phase.kind !== "interrupted"
    );
  }

  /** Captures the exact turn that authored a durable write. */
  #storeGuard(task: WorkspaceTask): () => boolean {
    if (task.phase.kind === "interrupted") return () => true;
    const controller = this.#activeTurns.controller(task.id);
    if (!controller) return () => true;
    return () =>
      this.#activeTurns.owns(task.id, controller) && !controller.signal.aborted;
  }

  async shutdown(): Promise<void> {
    this.#activeTurns.cancelAll();
    this.#waits.cancelAll();
  }

  async #interruptIfCurrent(
    taskId: string,
    controller: AbortController,
    reason?: string,
  ): Promise<void> {
    if (this.#activeTurns.owns(taskId, controller)) {
      await this.#records.interrupt(taskId, reason);
    }
  }

  resolveApproval(
    ...args: Parameters<TurnWaits["resolveApproval"]>
  ): ReturnType<TurnWaits["resolveApproval"]> {
    return this.#waits.resolveApproval(...args);
  }

  resolveUserInput(
    ...args: Parameters<TurnWaits["resolveUserInput"]>
  ): ReturnType<TurnWaits["resolveUserInput"]> {
    return this.#waits.resolveUserInput(...args);
  }
}
