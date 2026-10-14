import type {
  CommandFileChanges,
  ReasoningSelection,
  WorkspaceTask,
} from "@zhiyin/contract";
import { picturesPerMessage, VisibleError } from "@zhiyin/contract";
import { AuxiliaryWork } from "./specialist/auxiliary-work.js";
import { ToolCalls } from "./tools/tool-calls.js";
import {
  SpecialistExecution,
  stoppedBeforeCompleting,
} from "./specialist/specialist-execution.js";
import type { SpecialistExecutionResult } from "./specialist/specialist-execution.js";
import { PluginActivation } from "./tools/plugin-activation.js";
import { PendingHandoffs } from "./specialist/pending-handoffs.js";
import { CommandEndings } from "./tools/command-endings.js";
import { TurnRecords } from "./turn/turn-records.js";
import { TurnWaits } from "./turn/turn-waits.js";
import { TurnOwnership } from "./turn/turn-ownership.js";
import { TurnLoop } from "./turn/turn-loop.js";
import { ContextGuard } from "./context/context-guard.js";
import { condenseBetweenTurns } from "./plan/request-plan.js";
import { beginUserTurn } from "./turn/start-turn.js";
import { modelText } from "./context/attachments.js";
import { settledAfterRestart, settledWhenTurnEnded } from "./turn/settling.js";
import { isOwnDefect } from "./turn/turn-recovery.js";
import { defaultWorkLimits, WorkLedger } from "./turn/work-limits.js";
import { writtenFiles } from "./turn/written-files.js";
import type { AgentLoopDependencies } from "./dependencies.js";

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
  readonly #commandEndings = new CommandEndings();
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
    this.#toolCalls = new ToolCalls(deps, {
      records: this.#records,
      auxiliary: this.#auxiliary,
      waits: this.#waits,
    });
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
      waits: this.#waits,
      toolCalls: this.#toolCalls,
      specialists: this.#specialists,
      pluginActivation: this.#pluginActivation,
      ownership: this.#activeTurns,
      pendingHandoffs: this.#pendingHandoffs,
      commandEndings: this.#commandEndings,
      context: this.#context,
    });
  }

  /**
   * A command this task started, carried on as a job, ended. Told to the turn
   * running, or to one woken for it; one that `wakes` nothing waits for the
   * next turn.
   */
  commandEnded(taskId: string, notice: string, wakes = true): void {
    this.#commandEndings.push(taskId, notice, wakes);
    if (wakes) this.#wakeIfQueued(taskId);
  }

  /**
   * This task's commands running as jobs changed. The list is kept with the
   * conversation, so that after a restart the model can be told they stopped.
   */
  async commandsChanged(taskId: string): Promise<void> {
    if (!this.#deps.host.find(taskId)) return;
    const task = this.#records.task(taskId);
    const jobs = this.#deps.capabilities
      .runningCommands(taskId)
      .map(({ id, command }) => ({ id, command }));
    if (JSON.stringify(jobs) === JSON.stringify(task.runningJobs)) return;
    await this.#records.replaceTask({ ...task, runningJobs: jobs });
  }

  /**
   * A job this task started ended, and this is what changed in its folder
   * while it ran. It belongs to the action whose call started the job.
   */
  async jobChanged(
    taskId: string,
    job: string,
    changes: CommandFileChanges,
  ): Promise<void> {
    if (!this.#deps.host.find(taskId)) return;
    const task = this.#records.task(taskId);
    const started = task.actions.find(
      (action) =>
        action.commandChanges?.status === "running" &&
        action.commandChanges.job === job,
    );
    if (!started) return;
    await this.#records.replaceTask({
      ...task,
      actions: task.actions.map((action) =>
        action === started ? { ...action, commandChanges: changes } : action,
      ),
    });
    await this.#records.announceWritten(taskId, writtenFiles([], changes));
  }

  /**
   * Takes a message from the person: as guidance for the turn that is
   * running, or as the start of a turn, which then runs on. It is settled once
   * the message is in the conversation, so the next one can be sent while this
   * one is answered; how the turn goes is told by the conversation.
   */
  async send(
    taskId: string,
    userInput: string,
    reasoning?: ReasoningSelection,
    attachments: readonly string[] = [],
    delivery?: "guidance",
  ): Promise<void> {
    const turn = await this.#take(
      taskId,
      userInput,
      reasoning,
      attachments,
      delivery,
    );
    // A turn writes its own failure into the conversation. What is left to
    // reject is that writing failing, which nobody is waiting on any more.
    void turn?.().catch((error: unknown) =>
      this.#deps.recordDefect?.({ taskId, error }),
    );
  }

  /** Sends a message as `send` does, and waits for the turn it starts to end. */
  async start(
    taskId: string,
    userInput: string,
    reasoning?: ReasoningSelection,
    attachments: readonly string[] = [],
    delivery?: "guidance",
  ): Promise<void> {
    const turn = await this.#take(
      taskId,
      userInput,
      reasoning,
      attachments,
      delivery,
    );
    await turn?.();
  }

  /**
   * Puts a message in its conversation. What comes back runs the turn the
   * message started; nothing does when it was guidance, or empty.
   */
  async #take(
    taskId: string,
    userInput: string,
    reasoning: ReasoningSelection | undefined,
    attachments: readonly string[],
    delivery: "guidance" | undefined,
  ): Promise<(() => Promise<void>) | undefined> {
    // A message sent while the conversation is being condensed goes out on
    // the condensed conversation.
    await this.#condensing.get(taskId);
    if (!this.#deps.host.historyAvailable())
      throw new VisibleError(
        "Saved history is unavailable. Retry after restoring access.",
      );
    if (this.#deps.rewind.restoring(taskId))
      throw new VisibleError(
        "Wait for file recovery to finish before starting another turn.",
      );
    const message = userInput.trim();
    if (!message && !attachments.length) return undefined;
    if (!this.#deps.host.find(taskId))
      throw new Error("The task does not exist.");

    if (delivery === "guidance" || this.#activeTurns.running(taskId)) {
      const owner = this.#activeTurns.controller(taskId);
      const claimed = attachments.length
        ? await this.#deps.sessions.claimDrafts(taskId, attachments)
        : [];
      if (claimed.length < attachments.length)
        throw new VisibleError(
          "The pasted text is no longer available. Paste it again.",
        );
      refuseTooManyPictures(claimed);
      const guidanceId = this.#deps.newMessageId();
      await this.#records.queueGuidance(taskId, {
        id: guidanceId,
        text: message,
        ...(claimed.length ? { attachments: claimed } : {}),
        status:
          owner && this.#activeTurns.owns(taskId, owner) ? "pending" : "draft",
      });
      if (!owner || !this.#activeTurns.owns(taskId, owner))
        await this.#records.releaseGuidance(taskId, guidanceId);
      return undefined;
    }

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
    const existingDrafts = this.#records
      .task(taskId)
      .guidance.filter((item) => item.status === "draft");
    const retained = existingDrafts
      .flatMap((item) => item.attachments ?? [])
      .filter((item) => attachments.includes(item.id));
    const freshIds = attachments.filter(
      (id) => !retained.some((item) => item.id === id),
    );
    const fresh = freshIds.length
      ? await this.#deps.sessions
          .claimDrafts(taskId, freshIds)
          .catch((error: unknown) => {
            this.#activeTurns.finish(taskId, controller);
            throw error;
          })
      : [];
    if (fresh.length < freshIds.length) {
      this.#activeTurns.finish(taskId, controller);
      throw new VisibleError(
        "The pasted text is no longer available. Paste it again.",
      );
    }
    const claimed = [...retained, ...fresh];
    try {
      refuseTooManyPictures(claimed);
    } catch (error) {
      this.#activeTurns.finish(taskId, controller);
      throw error;
    }

    let started: ReturnType<typeof beginUserTurn>;
    try {
      // A turn runs where its conversation lives, whatever the window last
      // displayed. A no-op when they already agree.
      await this.#deps.host.enterFolderOf(taskId);
      const existing = this.#records.task(taskId);
      started = beginUserTurn(existing, message, {
        messageId: this.#deps.newMessageId(),
        sequence: this.#records.nextTimelineSequence(existing),
        attachments: claimed,
        ...(reasoning ? { reasoning } : {}),
      });
      await this.#records.replaceTask({
        ...started.task,
        guidance: existing.guidance.filter((item) => item.status === "pending"),
      });
    } catch (error) {
      // A turn that never started gives its conversation back, or every later
      // message would wait for it.
      this.#activeTurns.finish(taskId, controller);
      throw error;
    }

    return async () => {
      // The name is asked for beside the turn, so the first answer does not
      // wait for it, and a name that cannot be written leaves the turn alone.
      const naming = started.shouldGenerateInitialTitle
        ? this.#auxiliary
            .nameConversation(
              taskId,
              modelText({ text: message, attachments: claimed }),
              controller.signal,
            )
            .catch((error: unknown) => {
              if (isOwnDefect(error))
                this.#deps.recordDefect?.({ taskId, error });
            })
        : undefined;
      await this.#turnLoop.run(taskId, controller, ledger);
      this.#wakeIfQueued(taskId);
      await naming;
    };
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
   * background specialist it started settles, or a command it started ends.
   * A no-op when a turn is already live for the task — that turn's own round
   * loop drains the same queue itself — or when the task can no longer run
   * one (deleted, or mid file recovery).
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
    try {
      await this.#deps.host.enterFolderOf(taskId);
    } catch (error) {
      this.#activeTurns.finish(taskId, controller);
      throw error;
    }
    await this.#turnLoop.run(taskId, controller, ledger, {
      initialDelegatedChildren:
        this.#records.task(taskId).specialistRuns.length,
    });
    this.#wakeIfQueued(taskId);
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
    this.#wakeIfQueued(taskId);
  }

  /**
   * Wakes the task for a handoff or a command ending still queued. Called as
   * one arrives, and again as each turn ends: one that arrived after a running
   * turn last looked at the queue would otherwise wait for the person's next
   * message.
   */
  #wakeIfQueued(taskId: string): void {
    if (
      !this.#pendingHandoffs.waiting(taskId) &&
      !this.#commandEndings.waiting(taskId)
    )
      return;
    if (this.#activeTurns.running(taskId)) return;
    if (this.#wakeScheduled.has(taskId)) return;
    this.#wakeScheduled.add(taskId);
    // What is queued stays queued for the next turn when this one cannot
    // start; a failure that is Zhiyin's own is kept for whoever looks into it.
    void this.#resume(taskId)
      .catch((error: unknown) => {
        if (isOwnDefect(error)) this.#deps.recordDefect?.({ taskId, error });
      })
      .finally(() => {
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

  /**
   * Rebuilds pending handoffs from saved runs as their conversations are read.
   * A handoff already waiting is not queued twice.
   */
  wakeSaved(tasks: readonly WorkspaceTask[]): void {
    for (const task of tasks) {
      for (const run of task.specialistRuns) {
        if (run.handoffDelivered !== false || run.status === "running")
          continue;
        if (this.#pendingHandoffs.holds(task.id, run.id)) continue;
        if (
          task.modelHistory.some(
            (entry) =>
              entry.kind === "notice" &&
              entry.content.includes(`Run: ${run.id}.`),
          )
        )
          continue;
        this.#pendingHandoffs.push(
          task.id,
          run.handoff
            ? {
                ok: true,
                runId: run.id,
                specialist: run.specialist,
                handoff: run.handoff,
              }
            : {
                ok: false,
                runId: run.id,
                specialist: run.specialist,
                reason:
                  run.reason ?? "The specialist stopped before finishing.",
                // One the person stopped stays stopped after a restart too.
                ...(run.reason === stoppedBeforeCompleting
                  ? { stopped: true as const }
                  : {}),
              },
        );
      }
      this.#wakeIfQueued(task.id);
    }
  }

  /** How a conversation's reasoning is settled once its turn has ended. */
  settleEndedTurn(task: WorkspaceTask): WorkspaceTask {
    return settledWhenTurnEnded(task);
  }

  /**
   * Asks for the answer now: the conversation's request is stopped where it
   * has only reasoned so far, and asked again. Says whether one was.
   */
  async answerNow(taskId: string): Promise<boolean> {
    return this.#turnLoop.answerNow(taskId);
  }

  /**
   * Has the messages waiting for the turn's next step sent now, where its
   * request has only reasoned so far. Says whether that request was stopped.
   */
  async sendNow(taskId: string): Promise<boolean> {
    return (
      Boolean(this.#deps.host.find(taskId)) && this.#turnLoop.sendNow(taskId)
    );
  }

  /**
   * Takes back a message that waits for the turn's next step: it returns to
   * the person as a draft, unread. One the model was already sent stays in
   * the conversation.
   */
  async takeBack(taskId: string, messageId: string): Promise<void> {
    if (!this.#deps.host.find(taskId))
      throw new Error("The task does not exist.");
    await this.#records.releaseGuidance(taskId, messageId);
  }

  async cancel(taskId: string): Promise<void> {
    this.#activeTurns.cancel(taskId);
    try {
      await this.#records.interrupt(taskId);
      await this.#records.releaseGuidance(taskId);
    } finally {
      // Ended even when the stop could not be saved: a command left running
      // would go on working for a turn that is over.
      await this.#deps.capabilities.stopConversation(taskId);
    }
  }

  /** Whether a turn is running in this conversation, including a specialist
   * still finishing in the background after its own turn ended. Asked of
   * what runs, not of the record, whose end may not have been saved. */
  running(taskId: string): boolean {
    return this.#activeTurns.runningUnder(taskId);
  }

  /** Whether any turn is running, not counting the one named. */
  anyRunning(exceptTaskId?: string): boolean {
    return this.#activeTurns.anyRunning(exceptTaskId);
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

  resolveApproval(
    ...args: Parameters<TurnWaits["resolveApproval"]>
  ): ReturnType<TurnWaits["resolveApproval"]> {
    return this.#waits.resolveApproval(...args);
  }

  revokeConversationPermission(
    taskId: string,
    permissionId: string,
  ): Promise<void> {
    return this.#records.revokeConversationPermission(taskId, permissionId);
  }

  resolveUserInput(
    ...args: Parameters<TurnWaits["resolveUserInput"]>
  ): ReturnType<TurnWaits["resolveUserInput"]> {
    return this.#waits.resolveUserInput(...args);
  }
}

/** One request keeps 8 pictures, so one message may carry no more. */
function refuseTooManyPictures(
  attachments: readonly { readonly kind: string }[],
): void {
  if (
    attachments.filter((item) => item.kind === "picture").length >
    picturesPerMessage
  )
    throw new VisibleError(
      `A message can carry at most ${picturesPerMessage} pictures.`,
    );
}
