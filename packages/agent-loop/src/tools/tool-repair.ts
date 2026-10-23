/**
 * Re-aiming one refused tool call with a separate model call, before the main
 * model is troubled with it.
 *
 * The refusal says what was wrong and which inputs it is about; a short prompt
 * carries those inputs, the rest of the call shortened, the person's intent,
 * what the model said just before the call and the last few calls rather than
 * the transcript.
 *
 * Only the inputs the refusal names come back from the repair, and everything
 * else in the call stays as the model wrote it (ADR 0010). A value the schema
 * found missing or malformed must come from the model's own call or from what
 * it said, and a malformed one keeps every piece of text the model wrote
 * there. A call a repair changed where only the schema found fault is asked
 * for every time, whatever was granted. The arguments must actually be
 * different from what was already refused, and the result must survive
 * inspection. A repair that fails any of those is discarded and the main model
 * takes over, which is also what happens when the repair says it cannot tell,
 * and when the refusal names nothing.
 */

import type { ToolCallInspection, ToolOwner, ToolSpec } from "@zhiyin/contract";
import type { RepairRejection } from "@zhiyin/audit";
import type { ModelMessage } from "@zhiyin/model-client";
import { recordRepairDecisionTool } from "../specialist/auxiliary-tools.js";
import { selfDescription } from "../context/self-description.js";
import { schemaFaults, withSchemaProblems } from "./schema-problems.js";
import {
  keysIn,
  removed,
  scalarsIn,
  stepsOf,
  unreachable,
  valueAt,
  withValueAt,
} from "./input-paths.js";
import {
  answerAllowance,
  reasoningAllowance,
  recentCalls,
  repairDecisionFrom,
  repairPrompt,
  shortened,
  type RepairDecision,
} from "./repair-guidance.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { AuxiliaryWork } from "../specialist/auxiliary-work.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";

/** Attempts a repair may make at re-aiming one refused call. */
export const maximumRepairAttempts = 2;

/** A repair of a refused call that has not answered by now is a non-answer. */
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

/** What the round around a call holds that a repair can learn from. */
export type RoundEvidence = {
  /** What the model said, and thought, in the round that made the call. */
  readonly text: string;
  readonly reasoning: string;
  /** The request so far: the calls already made and what came back. */
  readonly messages: readonly ModelMessage[];
  /**
   * The tools on offer, each as its own spec: the input a repaired call must
   * meet, without the purpose every call may carry.
   */
  readonly tools: readonly ToolSpec[];
};

export type RepairedCall = {
  readonly arguments: Record<string, unknown>;
  readonly inspection: Extract<ToolCallInspection, { readonly ok: true }>;
  /**
   * The repair changed an input only the schema found at fault: no grant or
   * allowance covers the call, which the person sees as repaired.
   */
  readonly asksEachTime: boolean;
};

type Refusal = Extract<ToolCallInspection, { readonly ok: false }>;

/** An input a repair may change; one the tool named is the tool's to vouch for. */
type Field = { readonly path: string; readonly vouched: boolean };

/** The inputs a refusal is about: those the tool names, then those the schema finds wrong. */
function faultyFields(
  refusal: Refusal,
  args: unknown,
  schema: unknown,
): Field[] {
  const named = [...new Set(refusal.faulty ?? [])].filter((path) =>
    stepsOf(path),
  );
  const found = [...new Set(schemaFaults(args, schema))].filter(
    (path) => !named.includes(path),
  );
  return [
    ...named.map((path) => ({ path, vouched: true })),
    ...found.map((path) => ({ path, vouched: false })),
  ];
}

/** The text pieces of a value, keys left out: what a re-shaping must keep. */
const piecesOf = (value: unknown): string[] =>
  scalarsIn(value)
    .map(String)
    .filter((piece) => piece !== "");

/** Whether a text is the given pieces and nothing else: lines joined, say. */
function joinedFrom(text: string, pieces: readonly string[]): boolean {
  let rest = text;
  for (const piece of [...pieces].sort((a, b) => b.length - a.length))
    rest = rest.split(piece).join(" ");
  return /^[\s,;]*$/.test(rest);
}

/**
 * Whether everything a repair put in came from the model's own call or from
 * what it said around it. Each key, and each text, number or true-or-false,
 * is one of the call's own values or keys, or text in the model's words. Text
 * may also be the pieces of the value that stood there joined together, as
 * lines given as a list become one text.
 */
function fromEvidence(
  value: unknown,
  call: unknown,
  said: string,
  before: unknown,
): boolean {
  const own = new Set([...scalarsIn(call).map(String), ...keysIn(call)]);
  const pieces = before === unreachable ? [] : piecesOf(before);
  return [...scalarsIn(value), ...keysIn(value)].every(
    (scalar) =>
      own.has(String(scalar)) ||
      (typeof scalar === "string" &&
        scalar !== "" &&
        (said.includes(scalar) || joinedFrom(scalar, pieces))),
  );
}

/** Whether a value keeps every piece of text that stood where it goes. */
function keepsText(value: unknown, before: unknown): boolean {
  if (before === unreachable) return true;
  const kept = piecesOf(value);
  return piecesOf(before).every((piece) =>
    kept.some((text) => text.includes(piece)),
  );
}

/** The call with the repair's values put in, or `unreachable`. */
function merged(
  args: unknown,
  decision: Extract<RepairDecision, { kind: "repair" }>,
): unknown {
  let result = args;
  for (const path of decision.remove) {
    result = withValueAt(result, path, removed);
    if (result === unreachable) return unreachable;
  }
  for (const [path, value] of Object.entries(decision.set)) {
    result = withValueAt(result, path, value);
    if (result === unreachable) return unreachable;
  }
  return result;
}

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
    {
      proposed,
      owner,
      refusal,
      round,
      signal,
    }: {
      readonly proposed: unknown;
      readonly owner: ToolOwner;
      readonly refusal: Refusal;
      readonly round: RoundEvidence;
      readonly signal: AbortSignal;
    },
  ): Promise<RepairedCall | undefined> {
    let current = proposed;
    let currentRefusal = refusal;
    // Evidence is the model's own call: never what an earlier attempt put in.
    let schemaChanged = false;
    const seen = new Set([JSON.stringify(proposed)]);
    const specification = round.tools.find((tool) => tool.name === call.name);
    const said = `${round.reasoning}\n${round.text}`;

    for (let attempt = 0; attempt < maximumRepairAttempts; attempt += 1) {
      if (signal.aborted) return undefined;
      const fields = faultyFields(
        currentRefusal,
        current,
        specification?.inputSchema,
      );
      // Nothing named, nothing to repair: the model that made the call fixes it.
      if (!fields.length) {
        await this.#reject(taskId, call.name, {
          reason: currentRefusal.reason,
          cause: "no-fields",
          before: current,
        });
        return undefined;
      }
      const decision = await this.#ask(
        taskId,
        call,
        {
          fields,
          args: current,
          reason: currentRefusal.reason,
          round,
        },
        signal,
      );
      if (!decision) return undefined;

      const allowed = new Set(fields.map((field) => field.path));
      const touched = [...Object.keys(decision.set), ...decision.remove];
      if (touched.some((path) => !allowed.has(path))) {
        // The one rejection that is a finding rather than a shrug: something
        // tried to change an input the refusal was not about.
        await this.#reject(taskId, call.name, {
          reason: currentRefusal.reason,
          cause: "content-changed",
          before: current,
          after: decision,
        });
        return undefined;
      }
      const vouched = new Set(
        fields.filter((field) => field.vouched).map((field) => field.path),
      );
      const checked = Object.entries(decision.set).filter(
        ([path]) => !vouched.has(path),
      );
      if (
        checked.some(
          ([path, value]) =>
            !fromEvidence(value, proposed, said, valueAt(proposed, path)),
        )
      ) {
        await this.#reject(taskId, call.name, {
          reason: currentRefusal.reason,
          cause: "not-in-evidence",
          before: current,
          after: decision,
        });
        return undefined;
      }
      if (
        checked.some(
          ([path, value]) => !keepsText(value, valueAt(proposed, path)),
        )
      ) {
        await this.#reject(taskId, call.name, {
          reason: currentRefusal.reason,
          cause: "text-dropped",
          before: current,
          after: decision,
        });
        return undefined;
      }
      schemaChanged ||= touched.some((path) => !vouched.has(path));
      const put = merged(current, decision);
      if (
        put === unreachable ||
        !put ||
        typeof put !== "object" ||
        Array.isArray(put)
      ) {
        await this.#reject(taskId, call.name, {
          reason: currentRefusal.reason,
          cause: "unusable-answer",
          before: current,
          after: decision,
        });
        return undefined;
      }
      // As on any call, a purpose is taken off before the tool sees the input.
      const proposal = selfDescription(
        put as Record<string, unknown>,
        specification,
      ).args;

      const serialized = JSON.stringify(proposal);
      // No progress: it has proposed something already refused.
      if (seen.has(serialized)) {
        await this.#reject(taskId, call.name, {
          reason: currentRefusal.reason,
          cause: "no-progress",
          before: current,
          after: proposal,
        });
        return undefined;
      }
      seen.add(serialized);

      const inspection = withSchemaProblems(
        await this.#inspect(taskId, owner, call.name, proposal),
        proposal,
        specification?.inputSchema,
      );
      if (inspection.ok) {
        await this.#audit(
          taskId,
          call.name,
          "repair-applied",
          currentRefusal.reason,
          { before: current, after: proposal },
        );
        return {
          arguments: proposal,
          inspection,
          asksEachTime: schemaChanged,
        };
      }
      // Only a refusal of the same kind is worth another attempt.
      if (!inspection.correctable) {
        await this.#reject(taskId, call.name, {
          reason: inspection.reason,
          cause: "still-refused",
          before: current,
          after: proposal,
        });
        return undefined;
      }
      current = proposal;
      currentRefusal = inspection;
    }
    await this.#reject(taskId, call.name, {
      reason: currentRefusal.reason,
      cause: "still-refused",
      before: current,
    });
    return undefined;
  }

  /**
   * Asks the repairer once, and returns a proposed repair or nothing. Every
   * way of getting nothing is written down, with the call as it stood.
   */
  async #ask(
    taskId: string,
    call: AssembledToolCall,
    question: {
      readonly fields: readonly Field[];
      readonly args: unknown;
      readonly reason: string;
      readonly round: RoundEvidence;
    },
    signal: AbortSignal,
  ): Promise<Extract<RepairDecision, { kind: "repair" }> | undefined> {
    const { fields, args, reason, round } = question;
    const task = this.#records.task(taskId);
    const specification = round.tools.find((tool) => tool.name === call.name);
    const faulty = fields.map((field) => {
      const value = valueAt(args, field.path);
      return value === unreachable
        ? { path: field.path }
        : { path: field.path, value };
    });
    const prompt = repairPrompt({
      userIntent:
        [...task.messages].reverse().find((message) => message.role === "user")
          ?.text ?? task.title,
      toolName: call.name,
      toolDescription: specification?.description ?? "",
      schema: specification?.inputSchema,
      faulty,
      reference: shortened(args),
      reason,
      roundText: round.text,
      roundReasoning: round.reasoning,
      recent: recentCalls(round.messages),
    });
    if (!prompt) {
      await this.#reject(taskId, call.name, {
        reason,
        cause: "too-large",
        before: args,
      });
      return undefined;
    }

    // A repair that has not answered promptly is abandoned rather than
    // waited on: the main model can always take it from here.
    const bounded = AbortSignal.any([
      signal,
      AbortSignal.timeout(repairTimeoutMs),
    ]);
    const response = await this.#auxiliary.askRepair(
      taskId,
      {
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        maximumOutputTokens: answerAllowance(JSON.stringify(faulty).length),
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
    await this.#reject(taskId, call.name, {
      reason,
      cause: decision
        ? "handover"
        : response.outOfRoom
          ? "out-of-room"
          : "unusable-answer",
      before: args,
    });
    return undefined;
  }

  /** Every way a repair can be thrown away leaves the same shape of record. */
  #reject(
    taskId: string,
    toolName: string,
    {
      reason,
      cause,
      before,
      after,
    }: {
      readonly reason: string;
      readonly cause: RepairRejection;
      readonly before: unknown;
      readonly after?: unknown;
    },
  ): Promise<void> {
    return this.#audit(taskId, toolName, "repair-rejected", reason, {
      cause,
      before,
      ...(after === undefined ? {} : { after }),
    });
  }
}
