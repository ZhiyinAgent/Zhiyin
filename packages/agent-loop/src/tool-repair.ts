/**
 * Re-aiming one refused tool call with a separate model call, before the main
 * model is troubled with it.
 *
 * The refusal says what was wrong; a short prompt carries it, the person's
 * intent, what the model said just before the call and the last few calls
 * rather than the transcript.
 *
 * Everything the repair proposes is checked before it is used: the content
 * fields the tool named must be untouched, the arguments must actually be
 * different from what was already refused, and the result must survive
 * inspection. A repair that fails any of those is discarded and the main model
 * takes over, which is also what happens when the repair says it cannot tell.
 *
 * A call whose input could not be read at all gets one attempt, and may only
 * have its syntax fixed: every text value it proposes must already be in the
 * raw input.
 */

import type { ToolCallInspection, ToolOwner, ToolSpec } from "@zhiyin/contract";
import type { RepairRejection } from "@zhiyin/audit";
import type { ModelMessage } from "@zhiyin/model-client";
import { recordRepairDecisionTool } from "./auxiliary-tools.js";
import {
  answerAllowance,
  keepsRawText,
  preservesContent,
  reasoningAllowance,
  recentCalls,
  repairDecisionFrom,
  repairPrompt,
  type RepairDecision,
  type RepairKind,
} from "./repair-guidance.js";
import type { TurnRecords } from "./turn-records.js";
import type { AuxiliaryWork } from "./auxiliary-work.js";
import type { AssembledToolCall } from "./turn-shared.js";

/** Attempts a repair may make at re-aiming one refused call. */
export const maximumRepairAttempts = 2;

/** A repair of a refused call that has not answered by now is a non-answer. */
const repairTimeoutMs = 20_000;

/**
 * A repair of unreadable input writes the whole call back, so its wait grows
 * with the call: a fixed start, and the answer at a conservative 50 tokens a
 * second, never beyond the ceiling.
 */
function unreadableTimeoutMs(rawLength: number): number {
  return Math.min(45_000, 10_000 + (answerAllowance(rawLength) / 50) * 1_000);
}

/** How a repair is written down, which the turn's own record keeper owns. */
export type AuditRepair = (
  taskId: string,
  toolName: string,
  kind: "repair-applied" | "repair-rejected",
  reason: string,
  extra?: {
    readonly cause?: RepairRejection;
    readonly before?: unknown;
    readonly after?: unknown;
  },
) => Promise<void>;

/** What the round around a call holds that a repair can learn from. */
export type RoundEvidence = {
  /** What the model said, and thought, in the round that made the call. */
  readonly text: string;
  readonly reasoning: string;
  /** The request so far: the calls already made and what came back. */
  readonly messages: readonly ModelMessage[];
  /** The tools on offer, for the schema of the one being repaired. */
  readonly tools: readonly ToolSpec[];
};

export type RepairedCall = {
  readonly arguments: Record<string, unknown>;
  readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
};

/** One question to the repairer, as either kind of repair asks it. */
type Question = {
  readonly taskId: string;
  readonly call: AssembledToolCall;
  readonly kind: RepairKind;
  readonly failedArguments: string;
  readonly reason: string;
  readonly preserve: readonly string[];
  readonly round: RoundEvidence;
  readonly timeoutMs: number;
};

export class ToolCallRepair {
  readonly #records: TurnRecords;
  readonly #auxiliary: AuxiliaryWork;
  readonly #inspect: (
    taskId: string,
    owner: ToolOwner,
    name: string,
    args: unknown,
  ) => Promise<ToolCallInspection>;
  readonly #audit: AuditRepair;

  constructor(parts: {
    readonly records: TurnRecords;
    readonly auxiliary: AuxiliaryWork;
    readonly inspect: (
      taskId: string,
      owner: ToolOwner,
      name: string,
      args: unknown,
    ) => Promise<ToolCallInspection>;
    readonly audit: AuditRepair;
  }) {
    this.#records = parts.records;
    this.#auxiliary = parts.auxiliary;
    this.#inspect = parts.inspect;
    this.#audit = parts.audit;
  }

  async repair(
    taskId: string,
    call: AssembledToolCall,
    proposed: unknown,
    owner: ToolOwner,
    refusal: Extract<ToolCallInspection, { readonly ok: false }>,
    round: RoundEvidence,
    signal: AbortSignal,
  ): Promise<RepairedCall | undefined> {
    let current = proposed;
    let currentRefusal = refusal;
    const seen = new Set([JSON.stringify(proposed)]);

    for (let attempt = 0; attempt < maximumRepairAttempts; attempt += 1) {
      if (signal.aborted) return undefined;
      const preserve = currentRefusal.preserveOnRepair ?? [];
      const decision = await this.#ask(
        {
          taskId,
          call,
          kind: "refused",
          failedArguments: JSON.stringify(current),
          reason: currentRefusal.reason,
          preserve,
          round,
          timeoutMs: repairTimeoutMs,
        },
        current,
        signal,
      );
      if (!decision) return undefined;
      if (!preservesContent(current, decision.arguments, preserve)) {
        // The one rejection that is a finding rather than a shrug: something
        // tried to change what an approved action would write.
        await this.#reject(
          taskId,
          call.name,
          currentRefusal.reason,
          "content-changed",
          current,
          decision.arguments,
        );
        return undefined;
      }

      const serialized = JSON.stringify(decision.arguments);
      // No progress: it has proposed something already refused.
      if (seen.has(serialized)) {
        await this.#reject(
          taskId,
          call.name,
          currentRefusal.reason,
          "no-progress",
          current,
          decision.arguments,
        );
        return undefined;
      }
      seen.add(serialized);

      const inspection = await this.#inspect(
        taskId,
        owner,
        call.name,
        decision.arguments,
      );
      if (inspection.ok) {
        await this.#audit(
          taskId,
          call.name,
          "repair-applied",
          currentRefusal.reason,
          { before: current, after: decision.arguments },
        );
        return { arguments: decision.arguments, inspection };
      }
      // Only a refusal of the same kind is worth another attempt.
      if (!inspection.correctable) {
        await this.#reject(
          taskId,
          call.name,
          inspection.reason,
          "still-refused",
          current,
          decision.arguments,
        );
        return undefined;
      }
      current = decision.arguments;
      currentRefusal = inspection;
    }
    await this.#reject(
      taskId,
      call.name,
      currentRefusal.reason,
      "still-refused",
      current,
    );
    return undefined;
  }

  /**
   * The arguments `call.arguments` was meant to be, when only its syntax was
   * wrong and one attempt can tell how. Inspection comes after, as for any
   * call.
   */
  async repairInput(
    taskId: string,
    call: AssembledToolCall,
    reason: string,
    round: RoundEvidence,
    signal: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> {
    const raw = call.arguments;
    const decision = await this.#ask(
      {
        taskId,
        call,
        kind: "unreadable",
        failedArguments: raw,
        reason,
        preserve: [],
        round,
        timeoutMs: unreadableTimeoutMs(raw.length),
      },
      raw,
      signal,
    );
    if (!decision) return undefined;
    if (!keepsRawText(raw, decision.arguments)) {
      await this.#reject(
        taskId,
        call.name,
        reason,
        "content-changed",
        raw,
        decision.arguments,
      );
      return undefined;
    }
    await this.#audit(taskId, call.name, "repair-applied", reason, {
      before: raw,
      after: decision.arguments,
    });
    return decision.arguments;
  }

  /**
   * Asks the repairer once, and returns a proposed repair or nothing. Every
   * way of getting nothing is written down, with the call as it stood.
   */
  async #ask(
    question: Question,
    before: unknown,
    signal: AbortSignal,
  ): Promise<Extract<RepairDecision, { kind: "repair" }> | undefined> {
    const { taskId, call, reason } = question;
    const task = this.#records.task(taskId);
    const specification = question.round.tools.find(
      (tool) => tool.name === call.name,
    );
    const prompt = repairPrompt({
      kind: question.kind,
      userIntent:
        [...task.messages].reverse().find((message) => message.role === "user")
          ?.text ?? task.title,
      toolName: call.name,
      toolDescription: specification?.description ?? "",
      schema: specification?.inputSchema,
      failedArguments: question.failedArguments,
      reason,
      preserve: question.preserve,
      roundText: question.round.text,
      roundReasoning: question.round.reasoning,
      recent: recentCalls(question.round.messages),
    });
    if (!prompt) {
      await this.#reject(taskId, call.name, reason, "too-large", before);
      return undefined;
    }

    // A repair that has not answered promptly is abandoned rather than
    // waited on: the main model can always take it from here.
    const bounded = AbortSignal.any([
      signal,
      AbortSignal.timeout(question.timeoutMs),
    ]);
    const response = await this.#auxiliary.askRepair(
      {
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        maximumOutputTokens: answerAllowance(question.failedArguments.length),
        tools: [recordRepairDecisionTool],
        signal: bounded,
      },
      reasoningAllowance,
      bounded,
    );
    if (signal.aborted) return undefined;

    const decision = response.answer
      ? repairDecisionFrom(response.answer)
      : undefined;
    if (decision?.kind === "repair") return decision;
    // Out of room is its own finding: the cap, not the repairer, failed.
    await this.#reject(
      taskId,
      call.name,
      reason,
      decision
        ? "handover"
        : response.outOfRoom
          ? "out-of-room"
          : "unusable-answer",
      before,
    );
    return undefined;
  }

  /** Every way a repair can be thrown away leaves the same shape of record. */
  #reject(
    taskId: string,
    toolName: string,
    reason: string,
    cause: RepairRejection,
    before: unknown,
    after?: unknown,
  ): Promise<void> {
    return this.#audit(taskId, toolName, "repair-rejected", reason, {
      cause,
      before,
      ...(after === undefined ? {} : { after }),
    });
  }
}
