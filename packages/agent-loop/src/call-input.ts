/**
 * A proposed call's input, from what the model streamed to the arguments a
 * tool is handed, or to a refusal the model can act on.
 *
 * Input that is not valid JSON used to end the turn and take the rest of its
 * batch with it. It is now a refusal like any a tool makes, reached only after
 * the fixes that cannot change a value and one repair have both failed. Either
 * way, `call.arguments` is left holding what the conversation should keep: the
 * corrected input, or an empty object in place of text no request can carry.
 * The raw text goes to the audit log and nowhere else.
 */

import type {
  AuditRepair,
  RoundEvidence,
  ToolCallRepair,
} from "./tool-repair.js";
import { readToolInput } from "./tool-input.js";
import { type Refusal, unreadableInput } from "./refusals.js";
import type { AssembledToolCall } from "./turn-shared.js";

export type CallInput =
  | {
      readonly ok: true;
      readonly arguments: Record<string, unknown>;
      /** Told to the model with the call's result when the input was fixed. */
      readonly note?: string;
    }
  | {
      readonly ok: false;
      readonly result: Refusal;
      /** Answered to the model alone, as a quiet correction. */
      readonly quiet: boolean;
    };

/** How a correction is written down, which the turn's record keeper owns. */
type AuditCorrection = (
  taskId: string,
  toolName: string,
  kind: "quiet-retry" | Parameters<AuditRepair>[2],
  reason: string,
  extra?: Parameters<AuditRepair>[4],
) => Promise<void>;

/** Shows the person a call that failed before it could run. */
type RecordFailure = (
  taskId: string,
  call: AssembledToolCall,
  reason: string,
  signal: AbortSignal,
) => Promise<void>;

export class CallInputs {
  readonly #repair: ToolCallRepair;
  readonly #audit: AuditCorrection;
  readonly #fail: RecordFailure;

  constructor(parts: {
    readonly repair: ToolCallRepair;
    readonly audit: AuditCorrection;
    readonly fail: RecordFailure;
  }) {
    this.#repair = parts.repair;
    this.#audit = parts.audit;
    this.#fail = parts.fail;
  }

  async read(
    taskId: string,
    call: AssembledToolCall,
    round: RoundEvidence,
    quietRetriesLeft: number,
    signal: AbortSignal,
  ): Promise<CallInput> {
    const raw = call.arguments;
    const input = readToolInput(raw);
    if (input.ok) {
      if (!input.corrections.length)
        return { ok: true, arguments: input.arguments };
      const fixed = input.corrections.join(", ");
      await this.#audit(
        taskId,
        call.name,
        "repair-applied",
        `Fixed ${fixed}.`,
        {
          before: raw,
          after: input.arguments,
        },
      );
      call.arguments = JSON.stringify(input.arguments);
      return {
        ok: true,
        arguments: input.arguments,
        note: `Zhiyin corrected this call's input (${fixed}).`,
      };
    }

    // What was cut off is missing, not garbled: no repair can supply it.
    const known = round.tools.some((tool) => tool.name === call.name);
    const repaired =
      input.cutOff || !known
        ? undefined
        : await this.#repair.repairInput(
            taskId,
            call,
            input.reason,
            round,
            signal,
          );
    if (repaired) {
      call.arguments = JSON.stringify(repaired);
      return {
        ok: true,
        arguments: repaired,
        note: `Zhiyin corrected this call's input (invalid JSON: ${input.problem}).`,
      };
    }

    call.arguments = "{}";
    const result = unreadableInput(input.reason, input.cutOff);
    if (quietRetriesLeft > 0) {
      await this.#audit(taskId, call.name, "quiet-retry", input.reason, {
        before: raw,
      });
      return { ok: false, result, quiet: true };
    }
    await this.#fail(taskId, call, result.reason, signal);
    return { ok: false, result, quiet: false };
  }
}
