/**
 * A specialist run's life in the conversation: delegated within the turn's
 * bound, recorded as it starts and as it ends however it ends, owned by the
 * turn that started it, and settled in the background for its handoff.
 */

import type {
  SpecialistDefinition,
  SpecialistHandoff,
  SpecialistRun as SpecialistRunRecord,
  ToolOwner,
  ToolSpec,
  WorkspaceDescription,
} from "@zhiyin/contract";
import type { ModelMessage, TokenLimitDetail } from "@zhiyin/model-client";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TaskPicture } from "./specialist-messages.js";
import type { ConversationMemory } from "../memory/conversation-memory.js";
import { RoundAnswers } from "../round/round-answers.js";
import type { ToolCalls } from "../tools/tool-calls.js";
import {
  ModelRound,
  type ModelRoundDependencies,
} from "../turn/model-round.js";
import { ParentTurnEnded, type TurnOwnership } from "../turn/turn-ownership.js";
import type { TurnRecords } from "../turn/turn-records.js";
import { isOwnDefect } from "../turn/turn-recovery.js";
import { nextTimelineSequence } from "../turn/timeline.js";
import {
  defaultSpecialistWorkLimits,
  WorkLedger,
  type WorkLimits,
} from "../turn/work-limits.js";
import { SpecialistRun } from "./specialist-run.js";

/** What running a specialist uses. */
export type SpecialistExecutionDependencies = Pick<
  AgentLoopDependencies,
  | "afterCalls"
  | "host"
  | "kept"
  | "memory"
  | "newMessageId"
  | "newSpecialistRunId"
  | "now"
  | "recordDefect"
  | "specialistWorkLimits"
> &
  ModelRoundDependencies;

/**
 * How many specialists one turn can delegate to. Each has a budget of its own;
 * this bounds the shape of the tree itself, so a turn cannot fan out an
 * unreviewable number of children.
 */
export const maxDelegatedChildren = 3;

export type DelegateRequest = {
  readonly id: string;
  readonly task: string;
};

function delegateRequest(value: unknown): DelegateRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "id" && key !== "task") ||
    typeof record["id"] !== "string" ||
    !record["id"].trim() ||
    typeof record["task"] !== "string" ||
    !record["task"].trim()
  )
    return;
  return { id: record["id"].trim(), task: record["task"].trim() };
}

export type SpecialistExecutionResult =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly specialist: SpecialistDefinition;
      readonly handoff: SpecialistHandoff;
      /** Its turn was stopped as it finished: told, and wakes nothing. */
      readonly stopped?: true;
    }
  | {
      readonly ok: false;
      readonly runId: string;
      readonly specialist: SpecialistDefinition;
      readonly reason: string;
      /** Ended by a stop: told to the next turn, and wakes nothing itself. */
      readonly stopped?: true;
    };

/** Why a run ended when its turn was stopped. */
const stoppedBeforeCompleting = "The specialist stopped before it completed.";

/**
 * The delegate_specialist tool call's own, immediate result. A run's actual
 * outcome is never returned here — it arrives later, once the run settles,
 * as a `handoff` notice the turn loop delivers.
 */
export type DelegationAck =
  | {
      readonly ok: true;
      readonly status: "started";
      readonly runId: string;
      readonly specialist: { readonly id: string; readonly name: string };
    }
  | { readonly ok: false; readonly reason: string };

export class SpecialistExecution {
  readonly #deps: SpecialistExecutionDependencies;
  readonly #records: TurnRecords;
  readonly #round: ModelRound;
  readonly #answers: RoundAnswers;
  readonly #toolCalls: ToolCalls;
  readonly #ownership: TurnOwnership;
  /** The size the conversation's requests are kept under. */
  readonly #budget: (taskId: string) => number;
  readonly #refused: (said: TokenLimitDetail, estimated: number) => void;
  /** Memory, which a specialist reads and never writes (ADR 0026). */
  readonly #memory: ConversationMemory;
  readonly #onSettled: (
    taskId: string,
    result: SpecialistExecutionResult,
  ) => void;

  constructor(
    deps: SpecialistExecutionDependencies,
    parts: {
      readonly records: TurnRecords;
      readonly toolCalls: ToolCalls;
      readonly ownership: TurnOwnership;
      /** The size the conversation's requests are kept under. */
      readonly budget: (taskId: string) => number;
      /** Told of a request refused as too long, to plan with less. */
      readonly refused: (said: TokenLimitDetail, estimated: number) => void;
      readonly onSettled: (
        taskId: string,
        result: SpecialistExecutionResult,
      ) => void;
      /** Told when the lab refuses one of its requests for their number. */
      readonly rateLimited: (taskId: string) => void;
      readonly memory: ConversationMemory;
    },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
    this.#round = new ModelRound(
      deps,
      parts.records,
      "specialist",
      parts.rateLimited,
    );
    this.#answers = new RoundAnswers(deps);
    this.#toolCalls = parts.toolCalls;
    this.#ownership = parts.ownership;
    this.#budget = parts.budget;
    this.#refused = parts.refused;
    this.#onSettled = parts.onSettled;
    this.#memory = parts.memory;
  }

  /** The budget each specialist run is held to. */
  get workLimits(): WorkLimits {
    return this.#deps.specialistWorkLimits ?? defaultSpecialistWorkLimits;
  }

  async run(options: {
    readonly taskId: string;
    readonly runId: string;
    readonly parentTurnId: string;
    readonly parentRunId?: string;
    readonly depth: number;
    readonly request: DelegateRequest;
    /** Pictures handed over with its task, each with where it is stored. */
    readonly pictures?: readonly TaskPicture[];
    /** Zhiyin started it, not the main agent. */
    readonly fromZhiyin?: boolean;
    /** Each of its requests asks for the least reasoning the model allows. */
    readonly leastReasoning?: boolean;
    readonly specialist: SpecialistDefinition;
    readonly tools: readonly ToolSpec[];
    readonly ownerOf: (name: string) => ToolOwner | undefined;
    /** The start of its requests, naming the tools it has. */
    readonly start: (tools: readonly ToolSpec[]) => readonly ModelMessage[];
    readonly workspace: WorkspaceDescription;
  }): Promise<SpecialistExecutionResult> {
    const ledger = new WorkLedger(this.workLimits, this.#deps.now());
    const { taskId, runId, specialist } = options;
    const childTurnId = `${taskId}:specialist:${runId}`;
    const controller = this.#ownership.start(childTurnId, options.parentTurnId);
    return this.#ownership.within(controller, async () => {
      const ownActionIds = () =>
        this.#records
          .task(taskId)
          .actions.filter((action) => action.specialistRunId === runId)
          .sort((a, b) => a.sequence - b.sequence)
          .map((action) => action.id);
      const run = new SpecialistRun(
        this.#deps,
        {
          records: this.#records,
          round: this.#round,
          answers: this.#answers,
          toolCalls: this.#toolCalls,
          memory: this.#memory,
          budget: this.#budget,
          refused: this.#refused,
        },
        {
          taskId,
          runId,
          specialist,
          task: options.request.task,
          ...(options.pictures ? { pictures: options.pictures } : {}),
          ...(options.fromZhiyin ? { fromZhiyin: true } : {}),
          ...(options.leastReasoning ? { leastReasoning: true } : {}),
          tools: options.tools,
          ownerOf: options.ownerOf,
          start: options.start,
          controller,
          ledger,
        },
      );

      try {
        // A start that cannot be saved ends the run as a failure would.
        await this.#storeRun(taskId, {
          id: runId,
          ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
          specialist,
          task: options.request.task,
          depth: options.depth,
          status: "running",
          startedAt: this.#deps.now().toISOString(),
          actionIds: [],
        });
        const handoff = await run.run();
        await this.#finishRun(
          taskId,
          runId,
          {
            status: "completed",
            handoff,
            actionIds: ownActionIds(),
            ...run.kept,
          },
          controller.signal,
        );
        this.#ownership.finish(childTurnId, controller);
        return {
          ok: true,
          runId,
          specialist,
          handoff,
          ...(controller.signal.aborted ? { stopped: true as const } : {}),
        };
      } catch (error) {
        // An error neither the model client nor this loop accounts for is
        // Zhiyin's own: it is kept for whoever looks into it, and its message
        // stays out of the conversation, as in the main loop.
        const ownDefect = !controller.signal.aborted && isOwnDefect(error);
        if (ownDefect) this.#deps.recordDefect?.({ taskId, error });
        const reason = controller.signal.aborted
          ? stoppedBeforeCompleting
          : ownDefect
            ? "Zhiyin stopped on an error of its own while this specialist was working."
            : error instanceof Error
              ? error.message
              : "The specialist failed before reporting.";
        // Let go even when the end cannot be saved, or the conversation would
        // count a specialist as running for good.
        try {
          await this.#finishRun(
            taskId,
            runId,
            {
              status:
                controller.signal.aborted || run.unreported
                  ? "interrupted"
                  : "failed",
              reason,
              actionIds: ownActionIds(),
              ...run.kept,
            },
            controller.signal,
          );
        } finally {
          this.#ownership.finish(childTurnId, controller);
        }
        return {
          ok: false,
          runId,
          specialist,
          reason,
          ...(controller.signal.aborted ? { stopped: true as const } : {}),
        };
      }
    });
  }

  /**
   * Resolves a proposed delegation and, once accepted, starts it running in
   * the background — one seam so the bound below is checked wherever a turn
   * can delegate, not duplicated at each call site. Never waits for the run
   * to finish: its eventual handoff or failure is delivered later, once
   * settled, through `onSettled`.
   */
  async delegate(options: {
    readonly taskId: string;
    readonly parentTurnId: string;
    readonly parsedArguments: unknown;
    readonly specialists: readonly SpecialistDefinition[];
    readonly delegatedChildren: number;
    /** The tools a specialist is handed, before its role narrows them. */
    readonly toolsFor: (
      specialist: SpecialistDefinition,
    ) => readonly ToolSpec[];
    readonly ownerOf: (name: string) => ToolOwner | undefined;
    /** The start of its requests, naming the tools it has. */
    readonly start: (tools: readonly ToolSpec[]) => readonly ModelMessage[];
    readonly workspace: WorkspaceDescription;
  }): Promise<{
    readonly result: DelegationAck;
    readonly delegatedChildren: number;
  }> {
    const request = delegateRequest(options.parsedArguments);
    const specialist = request
      ? options.specialists.find((item) => item.id === request.id)
      : undefined;
    if (!request || !specialist)
      return {
        result: {
          ok: false,
          reason: request
            ? "That specialist is no longer enabled."
            : "Choose one enabled specialist and a bounded task.",
        },
        delegatedChildren: options.delegatedChildren,
      };
    if (options.delegatedChildren >= maxDelegatedChildren)
      return {
        result: {
          ok: false,
          reason: `This turn has already delegated to ${maxDelegatedChildren} specialists. Finish or use their handoffs before delegating again.`,
        },
        delegatedChildren: options.delegatedChildren,
      };
    const runId = this.#deps.newSpecialistRunId();
    this.run({
      taskId: options.taskId,
      runId,
      parentTurnId: options.parentTurnId,
      depth: 1,
      request,
      specialist,
      tools: options.toolsFor(specialist),
      ownerOf: options.ownerOf,
      start: options.start,
      workspace: options.workspace,
    }).then(
      (result) => this.#onSettled(options.taskId, result),
      (error: unknown) =>
        this.#onSettled(options.taskId, {
          ok: false,
          runId,
          specialist,
          reason:
            error instanceof Error
              ? error.message
              : "The specialist failed before returning a handoff.",
          // Asked after its turn ended, as when the person stopped it: it
          // settles that turn rather than waking the conversation.
          ...(error instanceof ParentTurnEnded
            ? { stopped: true as const }
            : {}),
        }),
    );
    return {
      result: {
        ok: true,
        status: "started",
        runId,
        specialist: { id: specialist.id, name: specialist.name },
      },
      delegatedChildren: options.delegatedChildren + 1,
    };
  }

  async #storeRun(
    taskId: string,
    run: Omit<SpecialistRunRecord, "sequence">,
  ): Promise<void> {
    const task = this.#records.task(taskId);
    await this.#records.replaceTask({
      ...task,
      // Placed once, where it was delegated, so what comes after sorts after.
      specialistRuns: [
        ...task.specialistRuns,
        { ...run, sequence: nextTimelineSequence(task) },
      ],
    });
  }

  async #finishRun(
    taskId: string,
    runId: string,
    finish: SpecialistRun["kept"] &
      (
        | {
            readonly status: "completed";
            readonly handoff: SpecialistHandoff;
            readonly actionIds: readonly string[];
          }
        | {
            readonly status: "failed" | "interrupted";
            readonly reason: string;
            readonly actionIds: readonly string[];
          }
      ),
    stopped: AbortSignal,
  ): Promise<void> {
    // The run's end is recorded on no turn's behalf: a stopped specialist
    // settles its run rather than carrying on with it.
    const finishedAt = this.#deps.now().toISOString();
    await this.#ownership.outside(async () => {
      await this.#records.changeOutsideTurns(taskId, (task) =>
        task.specialistRuns.some(
          (run) => run.id === runId && run.finishedAt !== finishedAt,
        )
          ? {
              ...task,
              specialistRuns: task.specialistRuns.map((run) =>
                run.id === runId
                  ? {
                      ...run,
                      ...finish,
                      handoffDelivered: false,
                      finishedAt,
                      ...(stopped.aborted ? { quiet: true as const } : {}),
                    }
                  : run,
              ),
            }
          : undefined,
      );
      // Stopped while its end was being saved: the stop found it running,
      // so it is marked here, to wake nothing after a restart either.
      if (stopped.aborted)
        await this.#records.changeOutsideTurns(taskId, (task) =>
          task.specialistRuns.some((run) => run.id === runId && !run.quiet)
            ? {
                ...task,
                specialistRuns: task.specialistRuns.map((run) =>
                  run.id === runId ? { ...run, quiet: true as const } : run,
                ),
              }
            : undefined,
        );
    });
  }
}
