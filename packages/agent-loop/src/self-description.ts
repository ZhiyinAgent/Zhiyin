/**
 * What a tool call says about itself: what it is for and which plan item it
 * serves. Two optional arguments on every tool, taken off before the tool is
 * handed its input, so no tool ever sees them. ADR 0052.
 *
 * They replace a model call made before every action to write its label and
 * guess its plan item. The purpose is the working model's claim, shown as such;
 * approvals keep resting on what the code established about the action.
 */

import type { TaskPlanItem, ToolSpec } from "@zhiyin/contract";
import { guidanceTextLimits } from "./task-guidance.js";
import { refusal, type Refusal } from "./refusals.js";

/**
 * Bare on purpose: they are added to every tool, so every word here is paid on
 * every request. What they mean is said once, in the system prompt.
 */
const arguments_ = {
  purpose: { type: "string" },
  plan_item: { type: "string" },
} as const;

type ObjectSchema = {
  readonly type?: unknown;
  readonly properties?: Readonly<Record<string, unknown>>;
};

/**
 * The tool as offered, with the two arguments added. A tool whose own input
 * already uses either name is offered as it is, and keeps its arguments.
 */
export function selfDescribing(tool: ToolSpec): ToolSpec {
  const schema = tool.inputSchema as ObjectSchema;
  const properties = schema.properties ?? {};
  if (
    schema.type !== "object" ||
    "purpose" in properties ||
    "plan_item" in properties
  )
    return tool;
  return {
    ...tool,
    inputSchema: { ...schema, properties: { ...properties, ...arguments_ } },
  };
}

export type SelfDescription = {
  readonly purpose?: string;
  readonly planItem?: string;
};

/** The call's own input, and what it said about itself. */
export function selfDescription(
  args: Record<string, unknown>,
  tool: ToolSpec | undefined,
): { readonly args: Record<string, unknown>; readonly said: SelfDescription } {
  if (!tool || selfDescribing(tool) === tool) return { args, said: {} };
  const { purpose, plan_item: planItem, ...own } = args;
  const text = (value: unknown, maximum: number) =>
    typeof value === "string" && value.trim()
      ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
      : undefined;
  const sentence = text(purpose, guidanceTextLimits.description);
  const item = text(planItem, 64);
  return {
    args: own,
    said: {
      ...(sentence ? { purpose: sentence } : {}),
      ...(item ? { planItem: item } : {}),
    },
  };
}

/** The plan item a call named, when the plan has it. */
export function linkedItem(
  plan: readonly TaskPlanItem[],
  said: SelfDescription,
): string | undefined {
  return plan.some((item) => item.id === said.planItem)
    ? said.planItem
    : undefined;
}

/** Told to the model with the result when the item it named does not exist. */
export function unlinked(
  plan: readonly TaskPlanItem[],
  said: SelfDescription,
): { readonly planItem?: Refusal } {
  if (!said.planItem || linkedItem(plan, said)) return {};
  return {
    planItem: refusal(
      "input-check",
      `There is no plan item "${said.planItem}", so this action is not linked to any.`,
      plan.length
        ? `Use one of ${plan.map((item) => item.id).join(", ")}, or leave plan_item out.`
        : "This task has no plan: leave plan_item out.",
    ),
  };
}
