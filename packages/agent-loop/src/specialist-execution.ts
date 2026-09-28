import type {
  SpecialistDefinition,
  SpecialistHandoff,
  TaskAction,
  ToolOwner,
  ToolSpec,
  WorkspaceDescription,
} from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { estimatedRequestTokens } from "./conversation-context.js";
import { QuietFailures, withdrawCalls } from "./quiet-failures.js";
import type { AgentLoopDependencies } from "./dependencies.js";
import type { ToolCalls } from "./tool-calls.js";
import type { TurnOwnership } from "./turn-ownership.js";
import type { TurnRecords } from "./turn-records.js";
import { readToolInput } from "./tool-input.js";
import {
  type AssembledToolCall,
  answerableCalls,
  maximumQuietRetries,
  namelessCallFailure,
  protocolCall,
  rewriteCallArguments,
} from "./turn-shared.js";
import type { WorkLedger } from "./work-limits.js";
import { RoundResults } from "./result-size.js";
import { toolOutput } from "./notices.js";
import { refusal, skippedAfterDecline } from "./refusals.js";

/**
 * How many specialists one turn can delegate to. A shared renewable ledger
 * already bounds total cost and time; this bounds the shape of the tree
 * itself, so a turn cannot fan out an unreviewable number of children.
 */
export const maxDelegatedChildren = 3;

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

export function delegateRequest(value: unknown): DelegateRequest | undefined {
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
    }
  | {
      readonly ok: false;
      readonly runId: string;
      readonly specialist: SpecialistDefinition;
      readonly reason: string;
    };

/**
 * The delegate_specialist tool call's own, immediate result. A run's actual
 * outcome is never returned here — it arrives later, once the run settles,
 * as a system message the turn loop delivers (see `handoffMessage`).
 */
export type DelegationAck =
  | {
      readonly ok: true;
      readonly status: "started";
      readonly runId: string;
      readonly specialist: { readonly id: string; readonly name: string };
    }
  | { readonly ok: false; readonly reason: string };

/** What a settled run is reported back to the model as, once delivered. */
function handoffHeader(result: SpecialistExecutionResult): string {
  const { name, id } = result.specialist;
  return result.ok
    ? `Specialist "${name}" (${id}) finished in the background. Run: ${result.runId}. Handoff: ${JSON.stringify(result.handoff)}`
    : `Specialist "${name}" (${id}) stopped before finishing. Run: ${result.runId}. Reason: ${result.reason}`;
}

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

export function completeHandoffMessage(
  result: SpecialistExecutionResult,
  actions: readonly TaskAction[],
): string {
  const timeline = handoffTimeline(actions);
  return `${handoffHeader(result)}\nTool timeline (${timeline.length} calls, in order; recorded details are in the conversation):\n${timeline.map((line) => JSON.stringify(line)).join("\n")}`;
}

export function handoffMessage(
  result: SpecialistExecutionResult,
  actions: readonly TaskAction[],
  savedOutput?: string,
): string {
  const full = completeHandoffMessage(result, actions);
  if (full.length <= 12_000) return full;
  const header = handoffHeader(result);
  const timeline = handoffTimeline(actions);
  const shown = timeline.slice(0, 10).map((line) => ({
    ...line,
    call: line.call.slice(0, 120),
    target: line.target.slice(0, 120),
    summary: line.summary.slice(0, 120),
  }));
  const omitted = timeline.length - shown.length;
  const excerpt = `${header.slice(0, 7_000)}${header.length > 7_000 ? "… [report continues in the saved output]" : ""}\nTool timeline: ${timeline.length} calls; first ${shown.length}:\n${shown.map((line) => JSON.stringify(line)).join("\n")}\n${omitted} calls omitted from this notice.`;
  return savedOutput
    ? `${excerpt}\nRead the complete report and timeline with read_file({"path":"${savedOutput}"}); its numbered pages show the rest.`
    : `${excerpt}\nThe complete report and timeline remain in the specialist card, but the model could not retain a readable copy. Treat this handoff as incomplete.`;
}

export class SpecialistExecution {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
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
    },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
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
    readonly ledger: WorkLedger;
  }): Promise<SpecialistExecutionResult> {
    const runId = options.runId;
    const childTurnId = `${options.taskId}:specialist:${runId}`;
    const controller = this.#ownership.start(childTurnId, options.parentTurnId);
    const ownActionIds = () =>
      (this.#records.task(options.taskId).actions ?? [])
        .filter((action) => action.specialistRunId === runId)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .map((action) => action.id);
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
    const tools = [
      ...options.tools.filter(
        (tool) =>
          (!options.specialist.tools ||
            options.specialist.tools.includes(tool.name)) &&
          (options.specialist.access !== "read" ||
            (options.ownerOf(tool.name) === "built-in" &&
              tool.access === "read")),
      ),
      finishSpecialistTool,
    ];
    const quiet = new QuietFailures();

    try {
      for (;;) {
        const assembled = new Map<number, AssembledToolCall>();
        let text = "";
        let reportedUsage = false;
        const request = { messages, tools, signal: controller.signal };
        for await (const event of this.#deps.model.send(request)) {
          controller.signal.throwIfAborted();
          if (event.kind === "textDelta") text += event.text;
          else if (event.kind === "toolCallDelta") {
            const call = assembled.get(event.index) ?? {
              index: event.index,
              callId: "",
              name: "",
              arguments: "",
            };
            if (event.callId) call.callId = event.callId;
            if (event.name) call.name += event.name;
            if (event.argumentsDelta) call.arguments += event.argumentsDelta;
            assembled.set(event.index, call);
          } else if (event.kind === "usage") {
            reportedUsage = true;
            options.ledger.record(event.usage);
            await this.#deps.host.recordUsage(event.usage);
          }
        }
        if (!reportedUsage)
          options.ledger.estimate(
            estimatedRequestTokens(
              [...messages, { role: "assistant", content: text }],
              tools,
            ),
          );
        controller.signal.throwIfAborted();
        const calls = [...assembled.values()].sort(
          (left, right) => left.index - right.index,
        );
        const finish = calls.find(
          (call) => call.name === finishSpecialistTool.name,
        );
        if (finish) {
          if (calls.length !== 1)
            throw new Error(
              "The specialist tried to finish and request another action together.",
            );
          const input = readToolInput(finish.arguments);
          const result = input.ok ? handoff(input.arguments) : undefined;
          if (!result)
            throw new Error(
              "The specialist returned an invalid structured handoff.",
            );
          const actionIds = ownActionIds();
          await this.#finishRun(options.taskId, runId, {
            status: "completed",
            handoff: result,
            actionIds,
          });
          this.#ownership.finish(childTurnId, controller);
          return {
            ok: true,
            runId,
            specialist: options.specialist,
            handoff: result,
          };
        }
        if (calls.length === 0)
          throw new Error(
            "The specialist stopped without returning a structured handoff.",
          );

        const { answerable, nameless } = answerableCalls(
          calls,
          () => `call-${this.#deps.newMessageId()}`,
        );
        messages.push({
          role: "assistant",
          content: text,
          toolCalls: answerable.map(protocolCall),
        });
        const round = { text, reasoning: "", messages, tools };
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
            await this.#toolCalls.recordFailedProposal(
              options.taskId,
              call,
              "The specialist requested a tool outside its role.",
              reason,
              runId,
              "blocked",
            );
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
            round,
            quietRetriesLeft,
            controller.signal,
            runId,
          );
          rewriteCallArguments(messages, call);
          const outcome = input.ok
            ? await this.#toolCalls.runToolCall(
                options.taskId,
                call,
                input.arguments,
                options.ownerOf(call.name),
                controller,
                quietRetriesLeft,
                round,
                {},
                runId,
              )
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
        if (nameless) throw new Error(namelessCallFailure);
        options.ledger.completeToolRound();
        // A specialist has no one to ask when the shared budget runs out —
        // only the parent's own loop can prompt a person. Running in the
        // background makes that gap load-bearing, so it stops itself cleanly
        // instead of consuming the shared ledger unsupervised.
        if (options.ledger.reached(this.#deps.now()).length > 0) {
          const actionIds = ownActionIds();
          await this.#finishRun(options.taskId, runId, {
            status: "interrupted",
            reason:
              "The shared work budget was reached while this specialist was running in the background.",
            actionIds,
          });
          this.#ownership.finish(childTurnId, controller);
          return {
            ok: false,
            runId,
            specialist: options.specialist,
            reason:
              "The shared work budget was reached while this specialist was running in the background.",
          };
        }
      }
    } catch (error) {
      const reason = controller.signal.aborted
        ? "The specialist stopped before it completed."
        : error instanceof Error
          ? error.message
          : "The specialist failed before returning a handoff.";
      const actionIds = ownActionIds();
      await this.#finishRun(options.taskId, runId, {
        status: controller.signal.aborted ? "interrupted" : "failed",
        reason,
        actionIds,
      });
      this.#ownership.finish(childTurnId, controller);
      return { ok: false, runId, specialist: options.specialist, reason };
    }
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
    readonly ledger: WorkLedger;
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
      ledger: options.ledger,
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
    run: NonNullable<ReturnType<TurnRecords["task"]>["specialistRuns"]>[number],
  ): Promise<void> {
    const task = this.#records.task(taskId);
    await this.#records.replaceTask({
      ...task,
      specialistRuns: [...(task.specialistRuns ?? []), run],
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
  ): Promise<void> {
    const task = this.#records.task(taskId);
    await this.#records.replaceTask({
      ...task,
      specialistRuns: (task.specialistRuns ?? []).map((run) =>
        run.id === runId
          ? {
              ...run,
              ...finish,
              handoffDelivered: false,
              finishedAt: this.#deps.now().toISOString(),
            }
          : run,
      ),
    });
  }
}
