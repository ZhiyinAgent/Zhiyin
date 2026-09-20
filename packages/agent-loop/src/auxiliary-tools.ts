/**
 * Schemas for the auxiliary model calls — the ones that ask for an object
 * rather than for conversation.
 *
 * These live beside the parsers that consume them, and each schema must stay
 * in step with the parser named in its description: the schema is what the
 * provider constrains generation against, and the parser is what actually
 * decides whether an answer is usable. Neither replaces the other. A model can
 * still answer in prose, because `tool_choice` is never sent, so the parser
 * remains the only guarantee.
 */
import type { ModelTool } from "@zhiyin/model-client";
import { conversationTitleLimit } from "./conversation-context.js";
import { guidanceTextLimits } from "./task-guidance.js";

const conversationTitleProperty = {
  type: "string",
  maxLength: conversationTitleLimit,
  description: "Two to six specific words, with no punctuation at the end.",
} as const;

/** Consumed by `planFrom`, and by `conversationTitleFrom` when asked for. */
export function recordPlanTool(withConversationTitle: boolean): ModelTool {
  return {
    name: "record_plan",
    description: "Record the ordered plan for the task.",
    inputSchema: {
      type: "object",
      properties: {
        ...(withConversationTitle
          ? { conversationTitle: conversationTitleProperty }
          : {}),
        items: {
          // Zero is a real answer: a request answered by the reply itself has
          // no work to plan. `planFrom` reads an empty list as no plan.
          type: "array",
          minItems: 0,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              title: { type: "string", maxLength: guidanceTextLimits.title },
              criterion: {
                type: "string",
                maxLength: guidanceTextLimits.criterion,
                description: "Evidence a reviewer can observe.",
              },
            },
            required: ["title", "criterion"],
            additionalProperties: false,
          },
        },
      },
      required: withConversationTitle
        ? ["conversationTitle", "items"]
        : ["items"],
      additionalProperties: false,
    },
  };
}

/**
 * Consumed by `compactionFrom`, and by `conversationTitleFrom` when asked for.
 *
 * The name is asked for here rather than in a request of its own. This model
 * has just read the whole of the older conversation, which is more than a
 * second request could be given, and a conversation that has grown long enough
 * to compact is exactly the one whose first-message name has gone stale.
 */
export function recordCompactionTool(
  withConversationTitle: boolean,
): ModelTool {
  return {
    name: "record_compaction",
    description: "Record the compacted summary of the older conversation.",
    inputSchema: {
      type: "object",
      properties: {
        ...(withConversationTitle ? { title: conversationTitleProperty } : {}),
        summary: { type: "string" },
        retainedActionIds: {
          type: "array",
          maxItems: 16,
          items: { type: "string" },
          description: "Action IDs from the supplied evidence, never invented.",
        },
      },
      required: withConversationTitle
        ? ["title", "summary", "retainedActionIds"]
        : ["summary", "retainedActionIds"],
      additionalProperties: false,
    },
  };
}

/** Consumed by `actionPresentationFrom`. */
export const recordActionPresentationTool: ModelTool = {
  name: "record_action_presentation",
  description: "Record the interface title and description for an action.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        maxLength: guidanceTextLimits.title,
        description: "A specific two-to-six-word verb phrase.",
      },
      description: {
        type: "string",
        maxLength: guidanceTextLimits.description,
        description: "One sentence on the action's purpose in this task.",
      },
      planItemId: {
        type: ["string", "null"],
        description: "The plan item this action serves, or null.",
      },
    },
    required: ["title", "description", "planItemId"],
    additionalProperties: false,
  },
};

/** Consumed by `criterionEvaluationFrom`. */
export const recordCriterionEvaluationTool: ModelTool = {
  name: "record_criterion_evaluation",
  description: "Record whether one plan criterion is satisfied.",
  inputSchema: {
    type: "object",
    properties: {
      satisfied: { type: "boolean" },
      summary: {
        type: "string",
        maxLength: guidanceTextLimits.summary,
        description: "One or two sentences on what the evidence shows.",
      },
    },
    required: ["satisfied", "summary"],
    additionalProperties: false,
  },
};

/**
 * Consumed by `repairDecisionFrom`.
 *
 * `arguments` is deliberately unconstrained: it carries a corrected call for
 * whichever tool was refused, so its shape is that tool's schema and is not
 * known here.
 */
export const recordRepairDecisionTool: ModelTool = {
  name: "record_repair_decision",
  description: "Record whether to repair the refused call or hand over.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["repair", "handover"] },
      arguments: {
        type: "object",
        description: "Corrected arguments, required when repairing.",
      },
      reason: { type: "string" },
    },
    required: ["action"],
    additionalProperties: false,
  },
};
