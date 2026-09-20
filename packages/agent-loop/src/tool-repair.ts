/**
 * Re-aiming one refused tool call with a small model, before the main model is
 * troubled with it.
 *
 * The refusal says what was wrong; a short prompt carries it, the person's
 * intent and the last few observations rather than the transcript.
 *
 * Everything the small model proposes is checked before it is used: the content
 * fields the tool named must be untouched, the arguments must actually be
 * different from what was already refused, and the result must survive
 * inspection. A repair that fails any of those is discarded and the main model
 * takes over, which is also what happens when the small model says it cannot
 * tell.
 */

import type { ToolCallInspection, ToolOwner } from "@zhiyin/contract";
import type { RepairRejection } from "@zhiyin/audit";
import { recordRepairDecisionTool } from "./auxiliary-tools.js";
import {
  preservesContent,
  repairContextLines,
  repairDecisionFrom,
} from "./repair-guidance.js";
import type { AgentLoopDependencies } from "./index.js";
import type { TurnRecords } from "./turn-records.js";
import type { AuxiliaryWork } from "./auxiliary-work.js";
import {
  type AssembledToolCall,
  auxiliarySystemMessage,
} from "./turn-shared.js";

/** Attempts a small model may make at re-aiming one refused call. */
export const maximumRepairAttempts = 2;

/** A repair that has not answered by now is a non-answer; stop waiting on it. */
const repairTimeoutMs = 20_000;

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

export type RepairedCall = {
  readonly arguments: Record<string, unknown>;
  readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
};

export class ToolCallRepair {
  readonly #deps: AgentLoopDependencies;
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
    readonly deps: AgentLoopDependencies;
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
    this.#deps = parts.deps;
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
    signal: AbortSignal,
  ): Promise<RepairedCall | undefined> {
    const task = this.#records.task(taskId);
    const specification = this.#deps.capabilities.builtInTool(call.name);
    const userIntent =
      [...task.messages].reverse().find((message) => message.role === "user")
        ?.text ?? task.title;

    let current = proposed;
    let currentRefusal = refusal;
    const seen = new Set([JSON.stringify(proposed)]);

    for (let attempt = 0; attempt < maximumRepairAttempts; attempt += 1) {
      if (signal.aborted) return undefined;
      const lines = repairContextLines({
        userIntent,
        toolName: call.name,
        toolDescription: specification?.description ?? "",
        failedArguments: JSON.stringify(current),
        reason: currentRefusal.reason,
        preserve: currentRefusal.preserveOnRepair ?? [],
        recent: (task.actions ?? []).map((action) => ({
          action: action.action,
          target: action.target,
          status: action.status,
          evidence: action.evidence,
        })),
      });
      if (!lines) {
        await this.#reject(
          taskId,
          call.name,
          currentRefusal.reason,
          "too-large",
          current,
        );
        return undefined;
      }

      // A repair that has not answered promptly is abandoned rather than
      // waited on: the main model can always take it from here.
      const bounded = AbortSignal.any([
        signal,
        AbortSignal.timeout(repairTimeoutMs),
      ]);
      const response = await this.#auxiliary.askGuidance(
        {
          messages: [
            { role: "system", content: auxiliarySystemMessage },
            { role: "user", content: lines.join("\n") },
          ],
          maximumOutputTokens: 900,
          tools: [recordRepairDecisionTool],
          signal: bounded,
        },
        bounded,
      );
      if (signal.aborted) return undefined;

      const decision = response ? repairDecisionFrom(response) : undefined;
      if (!decision) {
        await this.#reject(
          taskId,
          call.name,
          currentRefusal.reason,
          "unusable-answer",
          current,
        );
        return undefined;
      }
      if (decision.kind === "handover") {
        await this.#reject(
          taskId,
          call.name,
          currentRefusal.reason,
          "handover",
          current,
        );
        return undefined;
      }
      if (
        !preservesContent(
          current,
          decision.arguments,
          currentRefusal.preserveOnRepair ?? [],
        )
      ) {
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
