/**
 * The plan as the working model sees and reports on it. ADR 0052.
 *
 * The planner writes the items and their criteria, and the judge sets each
 * verdict; neither is the working model, so it cannot mark its own work. What
 * it can do is see the plan it will be judged on, say where each item stands,
 * add a criterion it discovers, and cite the calls that show an item done.
 * That progress is its claim, kept apart from the verdict. A claim of done
 * sends the items to the judge, and what it finds missing comes back as a
 * `gaps` notice (ADR 0053).
 *
 * The plan reaches it as a notice: in the first request of each turn, and
 * again when ten rounds pass with items open and no update. Both are worked out
 * from the history as saved, so a replay sends the same notices.
 */

import type {
  PlanProgress as Progress,
  TaskPlanItem,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { harnessNotice } from "./notices.js";
import { refusal } from "./refusals.js";
import { guidanceTextLimits } from "./task-guidance.js";
import type { ModelHistory } from "./model-history.js";
import type { TurnRecords } from "./turn-records.js";
import type { CallInput } from "./call-input.js";
import type { AssembledToolCall } from "./turn-shared.js";
import type { PlanJudge } from "./plan-judge.js";
import {
  linkedItem,
  selfDescription,
  unlinked,
  type SelfDescription,
} from "./self-description.js";

export const updatePlanToolName = "update_plan";

/** The most items a plan holds, counting the ones the working model adds. */
export const maximumPlanItems = 8;

/** Rounds with items open and no update before the plan is sent again. */
export const staleAfterRounds = 10;

const progressValues = ["pending", "in_progress", "done", "cancelled"] as const;
const text = { type: "string" } as const;

/**
 * Worded tightly: it is offered in every request. Lengths are enforced when an
 * update is read, not declared here.
 */
export const updatePlanTool: ToolSpec = {
  name: updatePlanToolName,
  description:
    "Report plan progress; items left out keep theirs. Done needs evidence: this turn's call ids, each with what it shows. Cancelled needs a reason. add: criteria the plan lacks. A reviewer checks every criterion separately; updating the plan does not complete the work.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: text,
            progress: { type: "string", enum: progressValues },
            reason: text,
            evidence: {
              type: "array",
              items: {
                type: "object",
                properties: { call_id: text, shows: text },
              },
            },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: { text, done: { type: "boolean" } },
              },
            },
          },
          required: ["id", "progress"],
        },
      },
      add: {
        type: "array",
        items: {
          type: "object",
          properties: { title: text, criterion: text },
        },
      },
    },
    additionalProperties: false,
  },
};

const progressWords: Record<Progress, string> = {
  pending: "pending",
  in_progress: "in progress",
  done: "done, as you reported it",
  cancelled: "cancelled",
};

function verdictWords(item: TaskPlanItem): string {
  const reason = item.verification ? `: ${item.verification}` : "";
  if (item.status === "verified") return `verified${reason}`;
  if (item.status === "needs-attention") return `not verified${reason}`;
  if (item.status === "couldnt-judge") return `could not be judged${reason}`;
  if (item.status === "checking") return "being checked";
  return "not yet checked";
}

function itemLines(item: TaskPlanItem): string {
  return [
    `${item.id}: ${item.title}${item.addedBy ? " (added by you)" : ""}`,
    `  Criterion: ${item.criterion}`,
    `  Progress: ${progressWords[item.progress ?? "pending"]}${
      item.progressNote ? ` (${item.progressNote})` : ""
    }`,
    `  Verdict: ${verdictWords(item)}`,
  ].join("\n");
}

/** The plan, as the working model is shown it. */
export function planText(plan: readonly TaskPlanItem[], stale = false): string {
  return [
    stale
      ? `${staleAfterRounds} rounds have passed since the plan was last brought up to date. Report progress with update_plan. Do not present the task as finished while items are still open.`
      : "The plan for the person's request, written by Zhiyin's planner. After the turn, a reviewer checks each item's criterion against what your calls showed.",
    "Name the item each tool call serves in its plan_item argument, and report progress with update_plan. Marking an item done needs the ids of this turn's calls that show it.",
    ...plan.map(itemLines),
  ].join("\n");
}

const open = (item: TaskPlanItem) =>
  item.status !== "verified" &&
  item.progress !== "done" &&
  item.progress !== "cancelled";

type Update = {
  readonly id: string;
  readonly progress: Progress;
  readonly reason?: string;
  readonly evidence?: readonly {
    readonly call_id: string;
    readonly shows: string;
  }[];
  readonly steps?: readonly { readonly text: string; readonly done: boolean }[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const filled = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
/** Text on one line, shortened to its limit rather than refused for its length. */
const clamped = (value: string, maximum: number) => {
  const line = value.trim().replace(/\s+/g, " ");
  return line.length <= maximum ? line : `${line.slice(0, maximum - 1)}…`;
};
const {
  title: titleLength,
  description: lineLength,
  criterion: criterionLength,
} = guidanceTextLimits;

/** The plan after an update, or what is wrong with the update. */
export function updatedPlan(
  plan: readonly TaskPlanItem[],
  value: unknown,
  turnCalls: ReadonlySet<string>,
): { readonly plan: TaskPlanItem[] } | { readonly problem: string } {
  const updates =
    isRecord(value) && Array.isArray(value.items) ? value.items : [];
  const added = isRecord(value) && Array.isArray(value.add) ? value.add : [];
  if (!updates.length && !added.length)
    return { problem: "The update names no item and adds none." };
  const ids = plan.map((item) => item.id);
  for (const update of updates as Update[]) {
    if (!isRecord(update) || !ids.includes(String(update.id)))
      return {
        problem: `There is no plan item "${String(isRecord(update) ? update.id : update)}". ${ids.length ? `The plan has ${ids.join(", ")}.` : "The plan has no items; add one with add."}`,
      };
    if (!progressValues.includes(update.progress))
      return {
        problem: `The progress of ${update.id} must be one of ${progressValues.join(", ")}.`,
      };
    if (update.progress === "cancelled" && !filled(update.reason))
      return {
        problem: `Cancelling ${update.id} needs a reason the person can read.`,
      };
    if (update.progress === "done") {
      const cited = Array.isArray(update.evidence) ? update.evidence : [];
      if (
        !cited.length ||
        !cited.every((entry) => isRecord(entry) && filled(entry.shows))
      )
        return {
          problem: `Marking ${update.id} done needs the ids of this turn's calls that show it, each with one line on what it shows.`,
        };
      const foreign = cited.find(
        (entry) => !turnCalls.has(String(entry.call_id)),
      );
      if (foreign)
        return {
          problem: `The call "${String(foreign.call_id)}" is not from this turn. Cite calls made since the person's last message.`,
        };
    }
  }
  if (plan.length + added.length > maximumPlanItems)
    return {
      problem: `A plan holds at most ${maximumPlanItems} items; it has ${plan.length}.`,
    };
  if (
    !added.every(
      (item) => isRecord(item) && filled(item.title) && filled(item.criterion),
    )
  )
    return { problem: "Each added item needs a title and a criterion." };

  const changed = new Map(
    (updates as Update[]).map((update) => [update.id, update]),
  );
  const next: TaskPlanItem[] = plan.map((item) => {
    const update = changed.get(item.id);
    if (!update) return item;
    // What the item said before is replaced, not kept beside the new claim.
    const rest = Object.fromEntries(
      Object.entries(item).filter(
        ([key]) => key !== "progressNote" && key !== "evidence",
      ),
    ) as TaskPlanItem;
    return {
      ...rest,
      progress: update.progress,
      ...(update.progress === "cancelled"
        ? { progressNote: clamped(update.reason!, lineLength) }
        : {}),
      ...(update.progress === "done"
        ? {
            evidence: update.evidence!.map((entry) => ({
              callId: entry.call_id,
              shows: clamped(entry.shows, lineLength),
            })),
          }
        : {}),
      ...(Array.isArray(update.steps)
        ? {
            steps: update.steps
              .filter((step) => isRecord(step) && filled(step.text))
              .slice(0, 12)
              .map((step) => ({
                text: clamped(step.text, 120),
                done: step.done === true,
              })),
          }
        : {}),
    };
  });
  let number = plan.length;
  for (const item of added as { title: string; criterion: string }[]) {
    do number += 1;
    while (next.some((existing) => existing.id === `plan-${number}`));
    next.push({
      id: `plan-${number}`,
      title: clamped(item.title, titleLength),
      criterion: clamped(item.criterion, criterionLength),
      status: "pending",
      addedBy: "assistant",
    });
  }
  return { plan: next };
}

/** The plan's side of a turn: the notices it sends and the updates it takes. */
export class PlanProgress {
  readonly #records: TurnRecords;
  readonly #judge: PlanJudge;
  /** Conversations whose running turn has not sent its first request yet. */
  readonly #starting = new Set<string>();
  /** The tools each running turn offers. */
  readonly #tools = new Map<string, () => readonly ToolSpec[]>();

  constructor(records: TurnRecords, judge: PlanJudge) {
    this.#records = records;
    this.#judge = judge;
  }

  /**
   * A turn begins: no call of it has run, and its first request is next.
   * `tools` answers with the tools on offer, which activating a plugin changes.
   */
  begin(
    taskId: string,
    tools: () => readonly ToolSpec[],
    signal: AbortSignal,
  ): void {
    this.#tools.set(taskId, tools);
    this.#judge.begin(taskId, signal);
    this.#starting.add(taskId);
  }

  /**
   * A call's own input, what it said about itself, and what goes back with
   * its result. `update_plan` is answered here; any other call may be cited
   * from now on.
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
    const plan = this.#records.task(taskId).plan ?? [];
    const note = {
      ...(input.note ? { note: input.note } : {}),
      ...unlinked(plan, said),
    };
    if (call.name === updatePlanToolName)
      return { args, said, note, answered: await this.update(taskId, args) };
    const planItem = linkedItem(plan, said);
    this.#judge.called(taskId, {
      callId: call.callId,
      tool: call.name,
      args,
      ...(planItem ? { planItem } : {}),
      ...(said.purpose ? { purpose: said.purpose } : {}),
    });
    return { args, said, note };
  }

  /** What a call answered, as the working model was sent it. */
  answered(taskId: string, callId: string, result: string): void {
    this.#judge.answered(taskId, callId, result);
  }

  /** The end of the turn: every item still open is judged. */
  settle(taskId: string, finalAnswer: string): Promise<void> {
    return this.#judge.settle(taskId, finalAnswer);
  }

  /**
   * Sends the plan when a turn's first request is about to go, and again when
   * ten rounds have passed with items open and no update.
   */
  async remind(taskId: string, history: ModelHistory): Promise<void> {
    await this.#judge.tell(taskId, history);
    const first = this.#starting.delete(taskId);
    const plan = this.#records.task(taskId).plan ?? [];
    if (!plan.length) return;
    if (first) return history.notice("plan", planText(plan));
    if (!plan.some(open)) return;
    const opening = harnessNotice("plan", "").replace(/<\/zhiyin-notice>$/, "");
    const messages = history.messages();
    const anchor = messages.findLastIndex(
      (message) =>
        (message.role === "user" &&
          typeof message.content === "string" &&
          message.content.startsWith(opening)) ||
        (message.role === "assistant" &&
          (message.toolCalls ?? []).some(
            (call) => call.name === updatePlanToolName,
          )),
    );
    const rounds = messages
      .slice(anchor + 1)
      .filter((message) => message.role === "assistant").length;
    if (rounds >= staleAfterRounds)
      await history.notice("plan", planText(plan, true));
  }

  /** What `update_plan` answers, having applied the update when it holds. */
  async update(taskId: string, value: unknown): Promise<ToolInvocationResult> {
    const task = this.#records.task(taskId);
    const outcome = updatedPlan(
      task.plan ?? [],
      value,
      this.#judge.callIds(taskId),
    );
    if ("problem" in outcome)
      return refusal(
        "input-check",
        outcome.problem,
        "Correct the update and send it again. Nothing in the plan changed.",
      );
    await this.#records.replaceTask({ ...task, plan: outcome.plan });
    // Claimed now: newly done, or done again citing different calls.
    const claimed = outcome.plan.filter((item, index) => {
      const before = (task.plan ?? [])[index];
      return (
        item.progress === "done" &&
        item.status !== "verified" &&
        (before?.progress !== "done" ||
          JSON.stringify(before.evidence) !== JSON.stringify(item.evidence))
      );
    });
    await this.#judge.claimed(
      taskId,
      claimed.map((item) => item.id),
    );
    return { ok: true, value: planText(outcome.plan) };
  }
}
