/**
 * The plan the working model keeps. ADR 0010.
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
import { readAsKey } from "@zhiyin/contract";
import { refusal } from "../tools/refusals.js";
import type { ModelHistory } from "../context/model-history.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { LoopTool } from "../round/loop-tool.js";
import type { OpenAtEnd, TurnHooks } from "../turn/turn-hooks.js";

const updatePlanToolName = "update_plan";

/** The most items a plan holds; later ones are left out. */
const maximumPlanItems = 20;

/**
 * Rounds of work without an update after which the model is asked whether its
 * step has finished, once a round turns to a tool the step had not used: work
 * that keeps to the same tools is the step still under way. ADR 0010. Each
 * time it carries on without an update, the next question waits twice as
 * long: a step that really takes many rounds is not asked about every few,
 * and a plan left behind is still caught when the work changes.
 */
const roundsBeforeAsking = 4;

/**
 * The longest item title kept whole. The panel wraps a title and the pill
 * clips it, so this is only a guard against a paragraph; the schema says it,
 * so the model is never cut short against a limit it was not told.
 */
const maximumTitleLength = 200;

const statuses = ["pending", "in_progress", "done", "skipped"] as const;

/** Worded tightly: it is offered in every request. */
const updatePlanTool: ToolSpec = {
  name: updatePlanToolName,
  description:
    "Replace your plan with this list, in order, when the work takes several steps. Send the whole list each time. Keep exactly one item in_progress while you work. Call it at every step: alongside the first call of the next step, mark the finished one done and the next in_progress, or skipped if you will not do it. The person follows the work by it, so never mark several steps done at once at the end.",
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
    // Codex's tool of the same name takes the list as `plan`.
    [readAsKey]: { plan: "items" },
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
 * mid-word reads as broken in the plan.
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
 * unknown status read as pending, fields an item does not have ignored, only
 * the first item in progress, at most twenty. Only an update with no list at
 * all has nothing to correct. Each status read as pending, and each field
 * ignored, is kept, so the answer can say so.
 */
function updatedPlan(value: unknown):
  | {
      readonly plan: TaskPlanItem[];
      readonly misread: readonly { given: unknown; title: string }[];
      readonly ignored: readonly string[];
    }
  | { readonly problem: string } {
  if (!isRecord(value) || !Array.isArray(value.items))
    return {
      problem: "Send the whole plan as items: a list of {title, status}.",
    };
  let working = false;
  const misread: { given: unknown; title: string }[] = [];
  const ignored = new Set<string>();
  const plan = value.items
    .filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) &&
        typeof item.title === "string" &&
        item.title.trim().length > 0,
    )
    .slice(0, maximumPlanItems)
    .map((item, index): TaskPlanItem => {
      for (const key of Object.keys(item))
        if (key !== "title" && key !== "status") ignored.add(key);
      const title = clamped(item.title as string, maximumTitleLength);
      const known = statuses.includes(item.status as PlanStatus);
      if (!known) misread.push({ given: item.status, title });
      let status: PlanStatus = known ? (item.status as PlanStatus) : "pending";
      if (status === "in_progress") {
        if (working) status = "pending";
        working = true;
      }
      return { id: `plan-${index + 1}`, title, status };
    });
  return { plan, misread, ignored: [...ignored] };
}

/** The fields an update gave its items that an item does not have. */
function ignoredWords(ignored: readonly string[]): string {
  if (!ignored.length) return "";
  const names = ignored.map((key) => `"${key}"`);
  const listed =
    names.length === 1
      ? `${names[0]!} is not one of its fields and was`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!} are not its fields and were`;
  return ` An item is only {title, status}: ${listed} ignored; leave ${names.length === 1 ? "it" : "them"} out.`;
}

/**
 * What an update's unknown statuses were read as, grouped by what was sent:
 * a count alone would leave a model that wrote "completed" for done guessing.
 */
function misreadWords(
  misread: readonly { given: unknown; title: string }[],
): string {
  if (!misread.length) return "";
  const groups = new Map<string, string[]>();
  for (const { given, title } of misread) {
    const said =
      typeof given === "string"
        ? `"${given}"`
        : (JSON.stringify(given) ?? "No status");
    groups.set(said, [...(groups.get(said) ?? []), title]);
  }
  const parts = [...groups].map(([said, titles]) => {
    const names =
      titles.length === 1
        ? titles[0]!
        : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)!}`;
    return `${said} is not a status, so ${names} ${titles.length === 1 ? "is" : "are"} pending`;
  });
  return ` ${parts.join("; ")}: a status is pending, in_progress, done or skipped.`;
}

/**
 * The plan's side of one turn: the notices it sends at the turn's moments,
 * and the updates it answers as a tool of the loop's own. Made as the turn
 * begins, so nothing it counts outlives the turn.
 */
export class PlanProgress implements LoopTool, TurnHooks {
  readonly #records: TurnRecords;
  readonly #taskId: string;
  /** Whether the turn has not sent its first request yet. */
  #starting = true;
  /** Whether the turn was already reminded of open items. */
  #reminded = false;
  /** Rounds of work since the turn last updated its plan. */
  #since = 0;
  /** Whether the turn updated the plan in the round under way. */
  #updated = false;
  /** Rounds the turn waits before it is next asked. */
  #wait = roundsBeforeAsking;
  /** The tools called since the plan last changed: the step's own work. */
  #used = new Set<string>();

  constructor(records: TurnRecords, taskId: string) {
    this.#records = records;
    this.#taskId = taskId;
  }

  specs(): readonly ToolSpec[] {
    return [updatePlanTool];
  }

  /** Whether a call is the plan's own. */
  answers(name: string): boolean {
    return name === updatePlanToolName;
  }

  /** What `update_plan` answers, having applied the update when it holds. */
  async answer(
    _call: unknown,
    input: Record<string, unknown>,
  ): Promise<Readonly<Record<string, unknown>>> {
    return { ...(await this.#update(input)) };
  }

  /**
   * A round of work ended. After several with no update while a step is open,
   * the model is asked whether that step has finished, once the round turns
   * to a tool the step had not used. It is a question, not a judgement: a
   * step still under way needs no update.
   */
  async afterRound(
    history: ModelHistory,
    round: { readonly calls: readonly { readonly name: string }[] },
  ): Promise<void> {
    const updated = this.#updated;
    this.#updated = false;
    const called = round.calls
      .map((call) => call.name)
      .filter((name) => name !== updatePlanToolName);
    if (updated) {
      this.#wait = roundsBeforeAsking;
      this.#used = new Set(called);
    }
    const turned = called.some((name) => !this.#used.has(name));
    for (const name of called) this.#used.add(name);
    const since = updated ? 0 : this.#since + 1;
    const open = this.#open();
    if (since < this.#wait || !turned || !open.length) {
      this.#since = since;
      return;
    }
    this.#since = 0;
    this.#wait *= 2;
    const current =
      open.find((item) => item.status === "in_progress") ?? open[0]!;
    await history.notice(
      "plan",
      `Your plan has not changed for ${since} rounds and still shows "${current.title}" as ${statusWords[current.status]}. If that step has finished, call update_plan now: mark it done and the next one in_progress. If it is still under way, carry on.`,
    );
  }

  /** Shows the open items when the turn's first request is about to go. */
  async beforeRequest(history: ModelHistory): Promise<void> {
    if (!this.#starting) return;
    this.#starting = false;
    const open = this.#open();
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
   * Before the turn ends: the items it would leave open. Once per turn;
   * after that it may finish.
   */
  openAtEnd(): OpenAtEnd | undefined {
    if (this.#reminded) return undefined;
    const open = this.#open();
    if (!open.length) return undefined;
    this.#reminded = true;
    return {
      kind: "plan",
      text: [
        "These plan items are still open:",
        ...lines(open),
        "If they are finished, mark each done or skipped with update_plan and end there, without repeating your answer. If work remains, finish it, then say only what changed.",
      ].join("\n"),
    };
  }

  async #update(value: unknown): Promise<ToolInvocationResult> {
    const outcome = updatedPlan(value);
    if ("problem" in outcome)
      return refusal(
        "input-check",
        outcome.problem,
        "Send the update again. Nothing in the plan changed.",
      );
    const task = this.#records.task(this.#taskId);
    await this.#records.replaceTask({ ...task, plan: outcome.plan });
    this.#updated = true;
    const done = outcome.plan.filter((item) => item.status === "done").length;
    return {
      ok: true,
      value: `Plan updated: ${done} of ${outcome.plan.length} done.${misreadWords(outcome.misread)}${ignoredWords(outcome.ignored)}`,
    };
  }

  #open(): TaskPlanItem[] {
    return this.#records.task(this.#taskId).plan.filter(isOpen);
  }
}
