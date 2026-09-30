/**
 * The plan the working model keeps. ADR 0063.
 *
 * It writes the whole list with `update_plan`, and the list replaces the one
 * before. Nothing judges it: its job is to show a person where the work
 * stands. So an update is corrected rather than refused, because a refusal
 * loses the progress it carried, and the model is reminded once of what it
 * would leave open instead of being held to it.
 */

import type {
  PlanStatus,
  TaskPlanItem,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { refusal } from "../tools/refusals.js";
import type { ModelHistory } from "../context/model-history.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { CallInput } from "../tools/call-input.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import {
  selfDescription,
  type SelfDescription,
} from "../context/self-description.js";

export const updatePlanToolName = "update_plan";

/** The most items a plan holds; later ones are left out. */
export const maximumPlanItems = 8;

/**
 * The longest item title kept whole. The panel wraps a title and the pill
 * clips it, so this is only a guard against a paragraph; the schema says it,
 * so the model is never cut short against a limit it was not told.
 */
const maximumTitleLength = 200;

const statuses = ["pending", "in_progress", "done", "skipped"] as const;

/** Worded tightly: it is offered in every request. */
export const updatePlanTool: ToolSpec = {
  name: updatePlanToolName,
  description:
    "Replace your plan with this list, in order, when the work takes several steps. Send the whole list each time. Keep exactly one item in_progress while you work; mark each done as it finishes, or skipped if you will not do it.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: maximumPlanItems,
        items: {
          type: "object",
          properties: {
            title: { type: "string", maxLength: maximumTitleLength },
            status: { type: "string", enum: statuses },
          },
          required: ["title", "status"],
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

const statusWords: Record<PlanStatus, string> = {
  pending: "to do",
  in_progress: "in progress",
  done: "done",
  skipped: "skipped",
};

const isOpen = (item: TaskPlanItem) =>
  item.status === "pending" || item.status === "in_progress";

const lines = (items: readonly TaskPlanItem[]) =>
  items.map((item) => `- ${item.title} (${statusWords[item.status]})`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Text on one line, shortened to its limit rather than refused for its
 * length. It ends at a whole word and without an ellipsis: a title cut
 * mid-word read as broken in the plan.
 */
function clamped(value: string, maximum: number): string {
  const line = value.trim().replace(/\s+/g, " ");
  if (line.length <= maximum) return line;
  const cut = line.slice(0, maximum + 1);
  const space = cut.lastIndexOf(" ");
  const whole = space > maximum / 2 ? cut.slice(0, space) : cut.slice(0, -1);
  return whole.replace(/[\s,;:(–—-]+$/, "");
}

/**
 * The plan an update describes, corrected: untitled entries dropped, an
 * unknown status read as pending, only the first item in progress, at most
 * eight. Only an update with no list at all has nothing to correct.
 */
export function updatedPlan(
  value: unknown,
): { readonly plan: TaskPlanItem[] } | { readonly problem: string } {
  if (!isRecord(value) || !Array.isArray(value.items))
    return {
      problem: "Send the whole plan as items: a list of {title, status}.",
    };
  let working = false;
  const plan = value.items
    .filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) &&
        typeof item.title === "string" &&
        item.title.trim().length > 0,
    )
    .slice(0, maximumPlanItems)
    .map((item, index): TaskPlanItem => {
      let status: PlanStatus = statuses.includes(item.status as PlanStatus)
        ? (item.status as PlanStatus)
        : "pending";
      if (status === "in_progress") {
        if (working) status = "pending";
        working = true;
      }
      return {
        id: `plan-${index + 1}`,
        title: clamped(item.title as string, maximumTitleLength),
        status,
      };
    });
  return { plan };
}

/** The plan's side of a turn: the notices it sends and the updates it takes. */
export class PlanProgress {
  readonly #records: TurnRecords;
  /** Conversations whose running turn has not sent its first request yet. */
  readonly #starting = new Set<string>();
  /** Conversations already reminded of open items in their running turn. */
  readonly #reminded = new Set<string>();
  /** The tools each running turn offers. */
  readonly #tools = new Map<string, () => readonly ToolSpec[]>();

  constructor(records: TurnRecords) {
    this.#records = records;
  }

  /**
   * A turn begins, and its first request is next. `tools` answers with the
   * tools on offer, which activating a plugin changes.
   */
  begin(taskId: string, tools: () => readonly ToolSpec[]): void {
    this.#tools.set(taskId, tools);
    this.#starting.add(taskId);
    this.#reminded.delete(taskId);
  }

  /**
   * A call's own input and what it said about itself. `update_plan` is
   * answered here.
   */
  async take(
    taskId: string,
    call: AssembledToolCall,
    input: Extract<CallInput, { readonly ok: true }>,
  ): Promise<{
    readonly args: Record<string, unknown>;
    readonly said: SelfDescription;
    readonly note: Record<string, unknown>;
    readonly answered?: ToolInvocationResult;
  }> {
    const tools = this.#tools.get(taskId)?.() ?? [];
    const tool = tools.find((item) => item.name === call.name);
    const { args, said } = selfDescription(input.arguments, tool);
    const note = input.note ? { note: input.note } : {};
    if (call.name === updatePlanToolName)
      return { args, said, note, answered: await this.update(taskId, args) };
    return { args, said, note };
  }

  /** Shows the open items when a turn's first request is about to go. */
  async remind(taskId: string, history: ModelHistory): Promise<void> {
    if (!this.#starting.delete(taskId)) return;
    const open = (this.#records.task(taskId).plan ?? []).filter(isOpen);
    if (!open.length) return;
    await history.notice(
      "plan",
      [
        "Your plan still has open items. Keep it current with update_plan.",
        ...lines(open),
      ].join("\n"),
    );
  }

  /**
   * Before a turn ends: whether the model was just told what it leaves open,
   * and so should go on. Once per turn; after that it may finish.
   */
  async beforeFinishing(
    taskId: string,
    history: ModelHistory,
  ): Promise<boolean> {
    if (this.#reminded.has(taskId)) return false;
    const open = (this.#records.task(taskId).plan ?? []).filter(isOpen);
    if (!open.length) return false;
    this.#reminded.add(taskId);
    await history.notice(
      "plan",
      [
        "These plan items are still open:",
        ...lines(open),
        "Finish them, or update the plan to mark each done or skipped, before your final answer.",
      ].join("\n"),
    );
    return true;
  }

  /** What `update_plan` answers, having applied the update when it holds. */
  async update(taskId: string, value: unknown): Promise<ToolInvocationResult> {
    const outcome = updatedPlan(value);
    if ("problem" in outcome)
      return refusal(
        "input-check",
        outcome.problem,
        "Send the update again. Nothing in the plan changed.",
      );
    const task = this.#records.task(taskId);
    await this.#records.replaceTask({ ...task, plan: outcome.plan });
    const done = outcome.plan.filter((item) => item.status === "done").length;
    return {
      ok: true,
      value: `Plan updated: ${done} of ${outcome.plan.length} done.`,
    };
  }
}
