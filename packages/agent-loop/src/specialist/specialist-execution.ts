import type {
  SpecialistDefinition,
  SpecialistHandoff,
  SpecialistRun,
  TaskAction,
  ToolOwner,
  ToolSpec,
  WorkspaceDescription,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { QuietFailures, withdrawCalls } from "../tools/quiet-failures.js";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { ToolCalls } from "../tools/tool-calls.js";
import {
  ModelRound,
  ThoughtTooLong,
  withLeastReasoning,
} from "../turn/model-round.js";
import { ParentTurnEnded, type TurnOwnership } from "../turn/turn-ownership.js";
import type { TurnRecords } from "../turn/turn-records.js";
import { readToolInput } from "../tools/tool-input.js";
import {
  answerableCalls,
  maximumQuietRetries,
  namelessCallFailure,
  protocolCall,
  rewriteCallArguments,
} from "../turn/turn-shared.js";
import {
  defaultSpecialistWorkLimits,
  WorkLedger,
} from "../turn/work-limits.js";
import { RoundResults } from "../context/result-size.js";
import { harnessNotice, toolOutput } from "../turn/notices.js";
import {
  isOwnDefect,
  stoppedTwiceForReasoning,
} from "../turn/turn-recovery.js";
import { refusal, skippedAfterDecline } from "../tools/refusals.js";

/**
 * How many specialists one turn can delegate to. Each has a budget of its own;
 * this bounds the shape of the tree itself, so a turn cannot fan out an
 * unreviewable number of children.
 */
const maxDelegatedChildren = 3;

/**
 * Whose word that a tool only reads a read specialist takes: the app's own
 * code, and a connector's declaration in its plugin, which the connection
 * feature carries onto the tool. A server's annotations about itself never
 * reach `access`.
 */
const readingOwners = new Set<ToolOwner | undefined>(["built-in", "mcp"]);

export const delegateSpecialistToolName = "delegate_specialist";

/**
 * Named to the exact specialists a turn may delegate to right now, so the
 * model does not have to already know a valid id by some other means — the
 * schema itself is the directory. A specialist not yet offered here (its
 * plugin not activated, or not enabled at all) cannot be named in a call.
 */
export function delegateSpecialistTool(
  specialists: readonly SpecialistDefinition[],
): ToolSpec {
  return {
    name: delegateSpecialistToolName,
    description: [
      "Delegate one narrow part of the current task to an enabled specialist and receive its structured handoff.",
      "Available specialists:",
      ...specialists.map(
        (specialist) => `- ${specialist.id}: ${specialist.description}`,
      ),
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          enum: specialists.map((specialist) => specialist.id),
          description: "The enabled specialist id.",
        },
        task: {
          type: "string",
          description: "The exact bounded task to hand to the specialist.",
        },
      },
      required: ["id", "task"],
      additionalProperties: false,
    },
  };
}

const finishSpecialistTool: ToolSpec = {
  name: "finish_specialist",
  description:
    "Finish this specialist run with a structured, evidence-based handoff to the parent.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      findings: { type: "array", items: { type: "string" } },
      recommendations: { type: "array", items: { type: "string" } },
      limitations: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "findings", "recommendations", "limitations"],
    additionalProperties: false,
  },
};

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

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim())
    ? value.map((item) => item.trim())
    : undefined;
}

function handoff(value: unknown): SpecialistHandoff | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  const findings = stringList(record["findings"]);
  const recommendations = stringList(record["recommendations"]);
  const limitations = stringList(record["limitations"]);
  if (
    typeof record["summary"] !== "string" ||
    !record["summary"].trim() ||
    !findings ||
    !recommendations ||
    !limitations
  )
    return;
  return {
    summary: record["summary"].trim(),
    findings,
    recommendations,
    limitations,
  };
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
export const stoppedBeforeCompleting =
  "The specialist stopped before it completed.";

/**
 * The delegate_specialist tool call's own, immediate result. A run's actual
 * outcome is never returned here — it arrives later, once the run settles,
 * as a `handoff` notice the turn loop delivers (see `handoffMessage`).
 */
export type DelegationAck =
  | {
      readonly ok: true;
      readonly status: "started";
      readonly runId: string;
      readonly specialist: { readonly id: string; readonly name: string };
    }
  | { readonly ok: false; readonly reason: string };

/**
 * What Zhiyin says of a settled run: which specialist, and how it ended. The
 * report is not part of it: another model wrote that, after reading what it
 * was given, so it follows as output, data rather than instructions.
 */
function handoffHeader(result: SpecialistExecutionResult): string {
  const { name, id } = result.specialist;
  const reportFollows =
    "Its report follows as its own output: another model wrote it.";
  return result.ok
    ? `Specialist "${name}" (${id}) finished in the background. Run: ${result.runId}. ${reportFollows}`
    : `Specialist "${name}" (${id}) stopped before finishing. Run: ${result.runId}. Reason: ${result.reason} ${reportFollows}`;
}

/** The tool a handoff's report is fenced as the output of. */
export const handoffReportTool = "delegate_specialist";

function handoffTimeline(actions: readonly TaskAction[]) {
  return actions.map((action) => ({
    actionId: action.id,
    call: action.toolName ?? action.action,
    target: action.target,
    outcome: action.status,
    summary:
      action.reason ?? action.description ?? action.detail ?? action.status,
    details: `Recorded action ${action.id}`,
  }));
}

function handoffReport(result: SpecialistExecutionResult): string {
  return result.ok ? `Handoff: ${JSON.stringify(result.handoff)}\n` : "";
}

/** The whole report and timeline, as kept for read_file when too long. */
export function completeHandoffMessage(
  result: SpecialistExecutionResult,
  actions: readonly TaskAction[],
): string {
  const timeline = handoffTimeline(actions);
  return `${handoffReport(result)}Tool timeline (${timeline.length} calls, in order; recorded details are in the conversation):\n${timeline.map((line) => JSON.stringify(line)).join("\n")}`;
}

/**
 * What a specialist whose request was stopped for reasoning at length is told
 * when it is asked again. It has no person to ask: a round that neither acts
 * nor finishes fails it.
 */
const specialistDecidesNow =
  "Your last request was stopped: you reasoned at length without calling a tool, and that reasoning is gone. Do not start the analysis over. Decide with what you know now: call a tool, or call finish_specialist with what you have found.";

/** The handoff notice: Zhiyin's words, and the report fenced after them. */
export function handoffMessage(
  result: SpecialistExecutionResult,
  actions: readonly TaskAction[],
  savedOutput?: string,
): { readonly notice: string; readonly report: string } {
  const header = handoffHeader(result);
  const full = completeHandoffMessage(result, actions);
  if (full.length <= 12_000) return { notice: header, report: full };
  const report = handoffReport(result);
  const timeline = handoffTimeline(actions);
  const shown = timeline.slice(0, 10).map((line) => ({
    ...line,
    call: line.call.slice(0, 120),
    target: line.target.slice(0, 120),
    summary: line.summary.slice(0, 120),
  }));
  const omitted = timeline.length - shown.length;
  const excerpt = `${report.slice(0, 7_000)}${report.length > 7_000 ? "… [report continues in the saved output]\n" : ""}Tool timeline: ${timeline.length} calls; first ${shown.length}:\n${shown.map((line) => JSON.stringify(line)).join("\n")}\n${omitted} calls omitted from this notice.`;
  return {
    notice: savedOutput
      ? `${header}\nOnly an excerpt follows. Read the complete report and timeline with read_file({"path":"${savedOutput}"}); its numbered pages show the rest.`
      : `${header}\nOnly an excerpt follows. The complete report and timeline remain in the specialist card, but the model could not retain a readable copy. Treat this handoff as incomplete.`,
    report: excerpt,
  };
}

export class SpecialistExecution {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  readonly #round: ModelRound;
  readonly #toolCalls: ToolCalls;
  readonly #ownership: TurnOwnership;
  readonly #onSettled: (
    taskId: string,
    result: SpecialistExecutionResult,
  ) => void;

  constructor(
    deps: AgentLoopDependencies,
    parts: {
      readonly records: TurnRecords;
      readonly toolCalls: ToolCalls;
      readonly ownership: TurnOwnership;
      readonly onSettled: (
        taskId: string,
        result: SpecialistExecutionResult,
      ) => void;
      /** Told when the lab refuses one of its requests for their number. */
      readonly rateLimited: (taskId: string) => void;
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
    this.#toolCalls = parts.toolCalls;
    this.#ownership = parts.ownership;
    this.#onSettled = parts.onSettled;
  }

  async run(options: {
    readonly taskId: string;
    readonly runId: string;
    readonly parentTurnId: string;
    readonly parentRunId?: string;
    readonly depth: number;
    readonly request: DelegateRequest;
    readonly specialist: SpecialistDefinition;
    readonly tools: readonly ToolSpec[];
    readonly ownerOf: (name: string) => ToolOwner | undefined;
    readonly fixedMessages: readonly ModelMessage[];
    readonly workspace: WorkspaceDescription;
  }): Promise<SpecialistExecutionResult> {
    const ledger = new WorkLedger(
      this.#deps.specialistWorkLimits ?? defaultSpecialistWorkLimits,
      this.#deps.now(),
    );
    const runId = options.runId;
    const childTurnId = `${options.taskId}:specialist:${runId}`;
    const controller = this.#ownership.start(childTurnId, options.parentTurnId);
    return this.#ownership.within(controller, async () => {
      const ownActionIds = () =>
        this.#records
          .task(options.taskId)
          .actions.filter((action) => action.specialistRunId === runId)
          .sort((a, b) => a.sequence - b.sequence)
          .map((action) => action.id);

      const messages: ModelMessage[] = [
        ...options.fixedMessages,
        {
          role: "system",
          content: [
            `You are the ${options.specialist.name} specialist (${options.specialist.id}).`,
            options.specialist.instructions,
            `Your exact delegated task is: ${options.request.task}`,
            "Work only on that task. Use ordinary tools when evidence is needed; every tool remains subject to the parent's permission policy.",
            ...(options.specialist.access === "read"
              ? [
                  "This role can only read. Report any needed changes to the parent.",
                ]
              : []),
            "Finish by calling finish_specialist once with a concise structured handoff. Do not address the user directly.",
          ].join("\n"),
        },
      ];
      let tools = [
        ...options.tools.filter(
          (tool) =>
            // The space beside the conversation is the main agent's to give
            // back; a specialist never had it.
            tool.name !== "close_document" &&
            (!options.specialist.tools ||
              options.specialist.tools.includes(tool.name)) &&
            (options.specialist.access !== "read" ||
              (readingOwners.has(options.ownerOf(tool.name)) &&
                tool.access === "read")),
        ),
        finishSpecialistTool,
      ];
      const quiet = new QuietFailures();
      let wrappingUp = false;
      let spent = false;

      try {
        // A start that cannot be saved ends the run as a failure would.
        await this.#storeRun(options.taskId, {
          id: runId,
          ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
          specialist: options.specialist,
          task: options.request.task,
          depth: options.depth,
          status: "running",
          startedAt: this.#deps.now().toISOString(),
          actionIds: [],
        });
        /** The last request was stopped for reasoning at length. */
        let overthought = false;
        for (;;) {
          // The same round a turn runs, gathered without being shown, and
          // asked again as a turn's is when it reasons at length.
          const request = { messages, tools };
          const answered = await this.#round
            .run(
              options.taskId,
              controller,
              ledger,
              overthought
                ? withLeastReasoning(request, this.#deps.host.leastReasoning())
                : request,
              () => !controller.signal.aborted,
            )
            .catch((error: unknown) => {
              if (
                !(error instanceof ThoughtTooLong) ||
                controller.signal.aborted
              )
                throw error;
              if (overthought) throw new VisibleError(stoppedTwiceForReasoning);
              overthought = true;
              messages.push({
                role: "user",
                content: harnessNotice("thinking", specialistDecidesNow),
              });
              return undefined;
            });
          if (!answered) continue;
          overthought = false;
          const { calls, text, reasoning, replay } = answered;
          controller.signal.throwIfAborted();
          const finish = calls.find(
            (call) => call.name === finishSpecialistTool.name,
          );
          // A finish beside other calls is answered, not taken: the report would
          // be written before the results it asked for. Once the budget is spent
          // nothing else is on offer, so the report is all there is to take.
          if (finish && (calls.length === 1 || wrappingUp)) {
            const input = readToolInput(finish.arguments);
            const result = input.ok ? handoff(input.arguments) : undefined;
            if (!result)
              throw new VisibleError(
                "The specialist returned an invalid structured handoff.",
              );
            const actionIds = ownActionIds();
            await this.#finishRun(
              options.taskId,
              runId,
              {
                status: "completed",
                handoff: result,
                actionIds,
              },
              controller.signal,
            );
            this.#ownership.finish(childTurnId, controller);
            return {
              ok: true,
              runId,
              specialist: options.specialist,
              handoff: result,
              ...(controller.signal.aborted ? { stopped: true as const } : {}),
            };
          }
          if (wrappingUp) {
            spent = true;
            throw new VisibleError(
              `The specialist used up its work budget (${ledger.describe(this.#deps.now(), ledger.reached(this.#deps.now()))}) and did not report.`,
            );
          }
          if (calls.length === 0)
            throw new VisibleError(
              "The specialist stopped without returning a structured handoff.",
            );

          const { answerable, nameless } = answerableCalls(
            calls,
            () => `call-${this.#deps.newMessageId()}`,
          );
          // The round goes back as a turn's does, with its reasoning and what
          // the provider needs back: some refuse a later request without them.
          messages.push({
            role: "assistant",
            content: text,
            toolCalls: answerable.map(protocolCall),
            ...(reasoning ? { reasoning } : {}),
            ...(replay ? { replay } : {}),
          });
          const round = { text, reasoning, messages, tools };
          const sizes = new RoundResults((kept) =>
            this.#deps.sessions.keep("output", options.taskId, { text: kept }),
          );
          let declinedInBatch = false;
          for (const call of answerable) {
            if (declinedInBatch) {
              messages.push({
                role: "tool",
                toolCallId: call.callId,
                name: call.name,
                content: toolOutput(
                  call.name,
                  JSON.stringify(skippedAfterDecline()),
                ),
              });
              continue;
            }
            if (call.name === finishSpecialistTool.name) {
              messages.push({
                role: "tool",
                toolCallId: call.callId,
                name: call.name,
                content: toolOutput(
                  call.name,
                  JSON.stringify(
                    refusal(
                      "tool",
                      "The report was sent together with other actions, before their results were known.",
                      "Read the results of the other actions, then call finish_specialist on its own.",
                    ),
                  ),
                ),
              });
              continue;
            }
            if (!tools.some((tool) => tool.name === call.name)) {
              const reason =
                options.specialist.access === "read"
                  ? "This specialist can only read."
                  : "This specialist is not allowed to use this tool.";
              const result = refusal(
                "permission",
                reason,
                "Use a tool allowed for this specialist or report the limitation.",
              );
              await this.#toolCalls.recordFailedProposal(options.taskId, call, {
                description:
                  "The specialist requested a tool outside its role.",
                reason,
                specialistRunId: runId,
                status: "blocked",
                answer: result,
              });
              messages.push({
                role: "tool",
                toolCallId: call.callId,
                name: call.name,
                content: toolOutput(call.name, JSON.stringify(result)),
              });
              continue;
            }
            const quietRetriesLeft =
              maximumQuietRetries - quiet.attempts(call.name);
            const input = await this.#toolCalls.readInput(
              options.taskId,
              call,
              {
                round,
                quietRetriesLeft,
                signal: controller.signal,
                specialistRunId: runId,
              },
            );
            rewriteCallArguments(messages, call);
            const outcome = input.ok
              ? await this.#toolCalls.runToolCall(options.taskId, call, {
                  proposedArguments: input.arguments,
                  owner: options.ownerOf(call.name),
                  controller,
                  quietRetriesLeft,
                  round,
                  specialistRunId: runId,
                })
              : { result: input.result, quiet: input.quiet };
            if ("denied" in outcome && outcome.denied) declinedInBatch = true;
            controller.signal.throwIfAborted();
            rewriteCallArguments(messages, call);
            // What the tool answered for the model, without the person's copy
            // or pictures written out as text.
            const answered = {
              ...outcome.result,
              images: undefined,
              details: undefined,
              ...(input.ok && input.note ? { note: input.note } : {}),
            };
            messages.push({
              role: "tool",
              toolCallId: call.callId,
              name: call.name,
              content: toolOutput(
                call.name,
                await sizes.fit(JSON.stringify(answered), answered),
              ),
            });
            if (outcome.quiet) quiet.remember(call.name, call.callId);
            else if (outcome.result.ok)
              withdrawCalls(
                messages,
                quiet.take(call.name),
                (message) => message,
                (_, message) => message,
              );
          }
          if (nameless) throw new VisibleError(namelessCallFailure);
          ledger.completeToolRound();
          // A specialist has no one to ask for more. When its own budget is spent
          // it is given one request to report what it has, with nothing else on
          // offer, instead of being cut off and losing what it found.
          if (ledger.reached(this.#deps.now()).length > 0) {
            wrappingUp = true;
            tools = [finishSpecialistTool];
            messages.push({
              role: "user",
              content:
                "Your work budget is used up. Call finish_specialist now with what you have found so far, and list anything you did not finish under limitations.",
            });
          }
        }
      } catch (error) {
        // An error neither the model client nor this loop accounts for is
        // Zhiyin's own: it is kept for whoever looks into it, and its message
        // stays out of the conversation, as in the main loop.
        const own = !controller.signal.aborted && isOwnDefect(error);
        if (own) this.#deps.recordDefect?.({ taskId: options.taskId, error });
        const reason = controller.signal.aborted
          ? stoppedBeforeCompleting
          : own
            ? "Zhiyin stopped on an error of its own while this specialist was working."
            : error instanceof Error
              ? error.message
              : "The specialist failed before returning a handoff.";
        // Let go even when the end cannot be saved, or the conversation would
        // count a specialist as running for good.
        try {
          await this.#finishRun(
            options.taskId,
            runId,
            {
              status:
                controller.signal.aborted || spent ? "interrupted" : "failed",
              reason,
              actionIds: ownActionIds(),
            },
            controller.signal,
          );
        } finally {
          this.#ownership.finish(childTurnId, controller);
        }
        return {
          ok: false,
          runId,
          specialist: options.specialist,
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
    readonly tools: readonly ToolSpec[];
    readonly ownerOf: (name: string) => ToolOwner | undefined;
    readonly fixedMessages: readonly ModelMessage[];
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
      tools: options.tools,
      ownerOf: options.ownerOf,
      fixedMessages: options.fixedMessages,
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
    run: Omit<SpecialistRun, "sequence">,
  ): Promise<void> {
    const task = this.#records.task(taskId);
    await this.#records.replaceTask({
      ...task,
      // Placed once, where it was delegated, so what comes after sorts after.
      specialistRuns: [
        ...task.specialistRuns,
        { ...run, sequence: this.#records.nextTimelineSequence(task) },
      ],
    });
  }

  async #finishRun(
    taskId: string,
    runId: string,
    finish:
      | {
          readonly status: "completed";
          readonly handoff: SpecialistHandoff;
          readonly actionIds: readonly string[];
        }
      | {
          readonly status: "failed" | "interrupted";
          readonly reason: string;
          readonly actionIds: readonly string[];
        },
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
