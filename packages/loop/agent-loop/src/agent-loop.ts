import type {
  CommandFileChanges,
  MessageAttachment,
  ReasoningSelection,
  TaskAction,
  ToolInvocationResult,
  UndoRoomChoice,
  UndoRoomRequest,
  WorkspaceTask,
} from "@zhiyin/contract";
import { picturesPerMessage, VisibleError } from "@zhiyin/contract";
import { evidenceText } from "./context/evidence.js";
import { contextTarget } from "@zhiyin/context-budget";
import { AuxiliaryWork } from "./auxiliary/auxiliary-work.js";
import { sameValue } from "./canonical.js";
import { ToolCalls } from "./tools/tool-calls.js";
import { keepWhatRanChanged, withKept } from "./tools/action-backup.js";
import { SpecialistExecution } from "./specialist/specialist-execution.js";
import { onReviewerModel } from "./specialist/on-reviewer-model.js";
import { PluginActivation } from "./tools/plugin-activation.js";
import { PendingHandoffs } from "./specialist/pending-handoffs.js";
import { CommandEndings } from "./tools/command-endings.js";
import { TurnRecords } from "./turn/turn-records.js";
import { shellReach, type ShellReach } from "./tools/shell-reach.js";
import { TurnWaits } from "./turn/turn-waits.js";
import { TurnOwnership } from "./turn/turn-ownership.js";
import { turnWriteGuard } from "./turn/turn-write-guard.js";
import { TurnLoop } from "./turn/turn-loop.js";
import { ContextGuard } from "./context/context-guard.js";
import { condenseBetweenTurns } from "./context/between-turns.js";
import { beginUserTurn } from "./turn/start-turn.js";
import { withTurnFiles } from "./turn/turn-files.js";
import { modelText } from "./context/attachments.js";
import { settledAfterRestart, settledWhenTurnEnded } from "./turn/settling.js";
import { isOwnDefect } from "./turn/turn-recovery.js";
import { workLimitsOf, WorkLedger } from "./turn/work-limits.js";
import { writtenFiles } from "./turn/written-files.js";
import type { AgentLoopDependencies } from "./dependencies.js";
import { nextTimelineSequence } from "./turn/timeline.js";
import { Wakes } from "./turn/wakes.js";
import { StandingInstructions } from "./context/standing-instructions.js";
import { ConversationMemory } from "./memory/conversation-memory.js";
import { MemoryReview } from "./memory/memory-review.js";

export class AgentLoop {
  readonly #deps: AgentLoopDependencies;
  readonly #activeTurns = new TurnOwnership();
  readonly #records: TurnRecords;
  readonly #auxiliary: AuxiliaryWork;
  readonly #waits: TurnWaits;
  readonly #toolCalls: ToolCalls;
  readonly #specialists: SpecialistExecution;
  readonly #pluginActivation: PluginActivation;
  readonly #wakes: Wakes;
  readonly #turnLoop: TurnLoop;
  readonly #context: ContextGuard;
  /** A condensing the person asked for between turns, until it ends. */
  readonly #condensing = new Map<string, Promise<void>>();

  constructor(deps: AgentLoopDependencies) {
    this.#deps = deps;
    const pendingHandoffs = new PendingHandoffs();
    const commandEndings = new CommandEndings();
    this.#wakes = new Wakes({
      handoffs: pendingHandoffs,
      endings: commandEndings,
      running: (taskId) => this.#activeTurns.running(taskId),
      resume: (taskId) => this.#resume(taskId),
      recordDefect: deps.recordDefect,
    });
    this.#records = new TurnRecords(deps, turnWriteGuard(this.#activeTurns));
    this.#auxiliary = new AuxiliaryWork(deps, { records: this.#records });
    this.#waits = new TurnWaits(deps, { records: this.#records });
    this.#context = new ContextGuard(deps, this.#records);
    this.#toolCalls = new ToolCalls(deps, {
      records: this.#records,
      auxiliary: this.#auxiliary,
      waits: this.#waits,
    });
    const memory = new ConversationMemory(deps, this.#records);
    const specialistParts = {
      memory,
      records: this.#records,
      toolCalls: this.#toolCalls,
      ownership: this.#activeTurns,
      budget: (taskId: string) => this.#context.targetTokens(taskId),
      refused: (
        ...[said, estimated]: Parameters<ContextGuard["learnRefusal"]>
      ) => this.#context.learnRefusal(said, estimated),
      onSettled: (...[taskId, result]: Parameters<Wakes["handoffSettled"]>) =>
        this.#wakes.handoffSettled(taskId, result),
      rateLimited: (taskId: string) => this.#auxiliary.giveWay(taskId),
    };
    this.#specialists = new SpecialistExecution(deps, specialistParts);
    this.#pluginActivation = new PluginActivation(deps, {
      records: this.#records,
    });
    this.#turnLoop = new TurnLoop(deps, {
      instructions: new StandingInstructions(deps, {
        records: this.#records,
        waits: this.#waits,
      }),
      memory,
      review: new MemoryReview(deps, this.#records, memory),
      records: this.#records,
      waits: this.#waits,
      toolCalls: this.#toolCalls,
      specialists: this.#specialists,
      reviewing: (reviewer) =>
        new SpecialistExecution(onReviewerModel(deps, reviewer), {
          ...specialistParts,
          // Held to the conversation's budget in the reviewer's own window.
          budget: (taskId) =>
            contextTarget(
              this.#records.task(taskId).contextBudget ??
                deps.host.defaultContextBudget(),
              reviewer.modelWindow,
            ).targetTokens,
          refused: () => {},
        }),
      pluginActivation: this.#pluginActivation,
      ownership: this.#activeTurns,
      pendingHandoffs,
      commandEndings,
      context: this.#context,
      rateLimited: (taskId) => this.#auxiliary.giveWay(taskId),
    });
  }

  /**
   * A command this task started, carried on as a job, ended. Told to the turn
   * running, or to one woken for it; one that `wakes` nothing waits for the
   * next turn.
   */
  commandEnded(taskId: string, notice: string, wakes = true): void {
    this.#wakes.commandEnded(taskId, notice, wakes);
  }

  /**
   * What this task's sealed-off commands reach beyond the workspace, by the
   * grants it holds (ADR 0029). A conversation that is not open reaches
   * nothing granted.
   */
  shellReach(taskId: string): ShellReach {
    try {
      return shellReach(
        this.#records.task(taskId),
        this.#deps.workspace.workspaceRoot(taskId),
      );
    } catch {
      return { hosts: [], read: [], change: [], registries: true };
    }
  }

  /**
   * This task's commands running as jobs changed. The list is kept with the
   * conversation, so that after a restart the model can be told they stopped.
   */
  commandsChanged(taskId: string): Promise<void> {
    // A job's record is the job's, not its turn's: it lands after a stop
    // that ended the job, which is written from the call that started it.
    return this.#activeTurns.outside(() => this.#keepRunningJobs(taskId));
  }

  async #keepRunningJobs(taskId: string): Promise<void> {
    await this.#records.changeOutsideTurns(taskId, (task) => {
      const jobs = this.#deps.commands
        .runningCommands(taskId)
        .map(({ id, command }) => ({ id, command }));
      return sameValue(jobs, task.runningJobs)
        ? undefined
        : { ...task, runningJobs: jobs };
    });
  }

  /**
   * A job this task started ended, and this is what changed in its folder
   * while it ran, with the command's own answer. Both belong to the action
   * whose call started the job, which keeps them as it would have had the
   * command ended in time: what it brought, and the answer as evidence.
   */
  jobChanged(
    taskId: string,
    job: string,
    changes: CommandFileChanges,
    outcome?: ToolInvocationResult,
  ): Promise<void> {
    return this.#activeTurns.outside(() =>
      this.#keepJobChanges(taskId, job, changes, outcome),
    );
  }

  async #keepJobChanges(
    taskId: string,
    job: string,
    changes: CommandFileChanges,
    outcome: ToolInvocationResult | undefined,
  ): Promise<void> {
    const ended = outcome
      ? {
          ...(outcome.brings === "outside"
            ? { brings: "outside" as const }
            : {}),
          evidence: evidenceText({ ...outcome, images: undefined }),
        }
      : {};
    const runningAs = (action: TaskAction) =>
      action.commandChanges?.status === "running" &&
      action.commandChanges.job === job;
    // Against the copy of its folder taken before it ran, when one was, which
    // also says which files undo can put back; as the command left them
    // otherwise.
    // A job of a conversation since deleted, or of no conversation, is not kept.
    if (!this.#deps.host.find(taskId)) return;
    const waiting = this.#records.task(taskId).actions.find(runningAs);
    const recorded =
      waiting && this.#deps.runs.waiting(waiting.id)
        ? await this.#deps.runs.finish(waiting.id)
        : undefined;
    const shown = recorded ? withKept(changes, recorded) : changes;
    const found: { ran?: TaskAction | undefined } = {};
    const kept = await this.#records.changeOutsideTurns(taskId, (task) => {
      const started = task.actions.find(runningAs);
      // The change may be made again on a later write; one that finds it
      // already made keeps the action the first one found.
      if (started) found.ran = started;
      return started
        ? {
            ...task,
            actions: task.actions.map((action) =>
              action === started
                ? { ...action, ...ended, commandChanges: shown }
                : action,
            ),
          }
        : undefined;
    });
    if (!kept) return;
    const { ran } = found;
    if (ran)
      await keepWhatRanChanged(this.#deps.backups, {
        actionId: ran.id,
        folder: ran.folder ?? this.#deps.workspace.workspaceRoot(taskId),
        taskId,
        recorded: ran.id === waiting?.id ? recorded : undefined,
        changes,
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
    const blocked = await this.#startBlocked(taskId);
    if (blocked === "history") throw new VisibleError(historyUnavailable);
    if (blocked === "restoring")
      throw new VisibleError(
        "Wait for file recovery to finish before starting another turn.",
      );
    const message = userInput.trim();
    if (!message && !attachments.length) return undefined;
    if (blocked === "missing") throw new Error(conversationMissing);

    if (delivery === "guidance" || this.#activeTurns.running(taskId)) {
      const owner = this.#activeTurns.controller(taskId);
      const claimed = attachments.length
        ? await this.#deps.kept.claimDrafts(taskId, attachments)
        : [];
      if (claimed.length < attachments.length)
        throw new VisibleError(
          "The pasted text is no longer available. Paste it again.",
        );
      refuseTooManyPictures(claimed);
      const guidanceId = this.#deps.newMessageId();
      await this.#records.guidance.queue(taskId, {
        id: guidanceId,
        text: message,
        ...(claimed.length ? { attachments: claimed } : {}),
        status:
          owner && this.#activeTurns.owns(taskId, owner) ? "pending" : "draft",
      });
      if (!owner || !this.#activeTurns.owns(taskId, owner))
        await this.#records.guidance.release(taskId, guidanceId);
      return undefined;
    }

    // Registered before the first await: everything between the
    // already-running check above and this point must stay synchronous, or two
    // starts can both pass it.
    const controller = this.#activeTurns.start(taskId);
    const ledger = new WorkLedger(this.#workLimits(), this.#deps.now());
    let claimed: readonly MessageAttachment[];
    let started: ReturnType<typeof beginUserTurn>;
    try {
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
        ? await this.#deps.kept.claimDrafts(taskId, freshIds)
        : [];
      if (fresh.length < freshIds.length)
        throw new VisibleError(
          "The pasted text is no longer available. Paste it again.",
        );
      claimed = [...retained, ...fresh];
      refuseTooManyPictures(claimed);
      // A turn runs where its conversation lives, whatever the window last
      // displayed. A no-op when they already agree.
      await this.#deps.host.enterFolderOf(taskId);
      const existing = this.#records.task(taskId);
      started = beginUserTurn(existing, message, {
        messageId: this.#deps.newMessageId(),
        sequence: nextTimelineSequence(existing),
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
      // Where the lab limits how many requests are open, the name gives way
      // to the answer and is asked again once the turn is over.
      const name = () =>
        this.#auxiliary
          .nameConversation(
            taskId,
            modelText({ text: message, attachments: claimed }),
            controller.signal,
          )
          .catch((error: unknown) => {
            if (isOwnDefect(error))
              this.#deps.recordDefect?.({ taskId, error });
            return undefined;
          });
      // The turn's work, naming beside it included, is the turn's own.
      await this.#activeTurns.within(controller, async () => {
        const naming = started.shouldGenerateInitialTitle ? name() : undefined;
        await withTurnFiles(
          this.#deps,
          taskId,
          () => this.#records.task(taskId).conversationPermissions,
          (renewFiles) =>
            this.#turnLoop.run(taskId, controller, ledger, { renewFiles }),
        );
        // What waited when the person stopped the turn waits for their next
        // message, rather than starting a turn they just stopped.
        if (!controller.signal.aborted) this.#wakes.wakeIfQueued(taskId);
        if ((await naming) === "gaveWay") await name();
      });
    };
  }

  /**
   * Asks the person, in the conversation whose turn is writing, what to do
   * with a first write the undo budget has no room to save (ADR 0031). With
   * no turn running there, or once it is stopped, the write is refused, so
   * nothing is lost without a backup unasked.
   */
  async askUndoRoom(
    taskId: string,
    file: Omit<UndoRoomRequest, "kind" | "title">,
  ): Promise<UndoRoomChoice> {
    const controller = this.#activeTurns.controller(taskId);
    if (!controller || controller.signal.aborted) return "refuse";
    const choice = await this.#waits.waitForUndoRoom(
      taskId,
      file,
      controller.signal,
    );
    return choice === "cancelled" ? "refuse" : choice;
  }

  /**
   * Condenses the conversation because the person asked: at once when nothing
   * runs in it, else before the running turn's next request to the model.
   * Asked again while one runs, it waits for that one rather than queueing
   * another for the next message.
   */
  async condenseNow(taskId: string): Promise<void> {
    const blocked = await this.#startBlocked(taskId);
    if (blocked === "history") throw new VisibleError(historyUnavailable);
    if (blocked === "missing") throw new Error(conversationMissing);
    if (blocked === "restoring")
      throw new VisibleError(
        "Wait for file recovery to finish before compacting.",
      );
    const pending = this.#condensing.get(taskId);
    if (pending) return pending;
    this.#context.ask(taskId);
    if (this.#activeTurns.running(taskId)) return;

    const controller = this.#activeTurns.start(taskId);
    const condensing = this.#activeTurns.within(controller, async () => {
      try {
        await this.#deps.host.enterFolderOf(taskId);
        await condenseBetweenTurns(
          this.#deps,
          this.#records,
          this.#context,
          taskId,
          controller.signal,
          (id, start, conversation) =>
            this.#turnLoop.offeringBetweenTurns(id, start, conversation),
        );
      } finally {
        this.#activeTurns.finish(taskId, controller);
        // Something that ended while it condensed found the conversation
        // busy, whether the condensing finished or failed.
        if (!controller.signal.aborted) this.#wakes.wakeIfQueued(taskId);
      }
    });
    this.#condensing.set(
      taskId,
      condensing.catch(() => {}).finally(() => this.#condensing.delete(taskId)),
    );
    await condensing;
  }

  /**
   * What keeps work from starting in a conversation now, or nothing: saved
   * history that cannot be read, its files still being restored once any
   * restore under way has settled, or a conversation that does not exist.
   */
  async #startBlocked(
    taskId: string,
  ): Promise<"history" | "restoring" | "missing" | undefined> {
    if (!this.#deps.host.historyAvailable()) return "history";
    if (this.#deps.rewind.restoring(taskId))
      await this.#deps.host.settleRewind(taskId);
    if (this.#deps.rewind.restoring(taskId)) return "restoring";
    if (!this.#deps.host.find(taskId)) return "missing";
    return undefined;
  }

  /** What a turn starting now is held to: the person's settings. */
  #workLimits() {
    return this.#deps.workLimits ?? workLimitsOf(this.#deps.host.workPauses());
  }

  /**
   * Continues a conversation whose own turn already ended, woken for what
   * was queued for it. Nothing runs when a turn is already live — that turn
   * takes the queue itself — or when the conversation can no longer run one
   * (deleted, or mid file recovery). True when a turn ran and was not stopped.
   */
  async #resume(taskId: string): Promise<boolean> {
    if (this.#activeTurns.running(taskId)) return false;
    if (await this.#startBlocked(taskId)) return false;
    // Checked again after the wait: a turn starts only right after this check.
    if (this.#activeTurns.running(taskId)) return false;
    const controller = this.#activeTurns.start(taskId);
    const ledger = new WorkLedger(this.#workLimits(), this.#deps.now());
    try {
      await this.#deps.host.enterFolderOf(taskId);
    } catch (error) {
      this.#activeTurns.finish(taskId, controller);
      throw error;
    }
    await this.#activeTurns.within(controller, () =>
      withTurnFiles(
        this.#deps,
        taskId,
        () => this.#records.task(taskId).conversationPermissions,
        (renewFiles) =>
          this.#turnLoop.run(taskId, controller, ledger, {
            initialDelegatedChildren:
              this.#records.task(taskId).specialistRuns.length,
            renewFiles,
          }),
      ),
    );
    return !controller.signal.aborted;
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
    this.#wakes.restore(tasks);
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
    if (!this.#deps.host.find(taskId)) throw new Error(conversationMissing);
    await this.#records.guidance.release(taskId, messageId);
  }

  async cancel(taskId: string): Promise<void> {
    await this.#wakes.stopping(taskId, () => this.#stop(taskId));
  }

  async #stop(taskId: string): Promise<void> {
    this.#activeTurns.cancel(taskId);
    this.#turnLoop.stopReview(taskId);
    // The stop is written on no turn's behalf, wherever it was asked from.
    await this.#activeTurns.outside(async () => {
      try {
        await this.#records.interrupt(taskId);
        await this.#records.changeOutsideTurns(taskId, (task) =>
          task.specialistRuns.some(
            (run) =>
              run.status !== "running" &&
              run.handoffDelivered === false &&
              !run.quiet,
          )
            ? {
                ...task,
                specialistRuns: task.specialistRuns.map((run) =>
                  run.status !== "running" && run.handoffDelivered === false
                    ? { ...run, quiet: true as const }
                    : run,
                ),
              }
            : undefined,
        );
        await this.#records.guidance.release(taskId);
      } finally {
        // Ended even when the stop could not be saved: a command left running
        // would go on working for a turn that is over.
        await this.#deps.capabilities.stopConversation(taskId);
      }
    });
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

  async shutdown(): Promise<void> {
    this.#activeTurns.cancelAll();
    this.#turnLoop.stopReviews();
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
    return this.#records.grants.revoke(taskId, permissionId);
  }

  resolveUserInput(
    ...args: Parameters<TurnWaits["resolveUserInput"]>
  ): ReturnType<TurnWaits["resolveUserInput"]> {
    return this.#waits.resolveUserInput(...args);
  }
}

const historyUnavailable =
  "Saved history is unavailable. Retry after restoring access.";
const conversationMissing = "The task does not exist.";

/** One message may carry no more pictures than one request keeps. */
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
