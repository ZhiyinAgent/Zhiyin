/**
 * What a tool call says about itself: what it is for. One argument on every
 * tool, taken off before the tool is handed its input, unless the tool's own
 * input has it. ADR 0014.
 *
 * No model call is made before an action to write its label. The purpose is
 * the working model's claim, shown as such; approvals rest on what the code
 * established about the action.
 */

import { readAsKey, type ToolSpec } from "@zhiyin/contract";
import { guidanceTextLimits } from "./task-guidance.js";

/**
 * Bare on purpose: it is added to every tool, so every word here is paid on
 * every request. What it means is said once, in the system prompt.
 */
const arguments_ = { purpose: { type: "string" } } as const;

type ObjectSchema = {
  readonly type?: unknown;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: unknown;
};

/**
 * The tool as offered, with the argument added. A tool whose own input already
 * has it is offered as it is, but for the names its schema reads as others.
 *
 * The argument is listed among what a call has to give: offered as something
 * a call may give, two of three models gave it on no call at all, and each of
 * their actions was named by a request of its own. A call that leaves it out
 * still runs, and is named that way.
 */
export function selfDescribing(tool: ToolSpec): ToolSpec {
  const shown = shownSchema(tool);
  const schema = shown.inputSchema as ObjectSchema;
  const properties = schema.properties ?? {};
  if (schema.type !== "object" || "purpose" in properties) return shown;
  return {
    ...tool,
    inputSchema: {
      ...schema,
      properties: { ...properties, ...arguments_ },
      required: [
        ...(Array.isArray(schema.required) ? schema.required : []),
        "purpose",
      ],
    },
  };
}

export type SelfDescription = {
  readonly purpose?: string;
};

/**
 * The call's own input, and what it said about itself. A tool whose own input
 * has the argument is handed it, and its sentence names the call too, so the
 * model writes it once.
 */
export function selfDescription(
  args: Record<string, unknown>,
  tool: ToolSpec | undefined,
): { readonly args: Record<string, unknown>; readonly said: SelfDescription } {
  if (!tool) return { args, said: {} };
  const owned = ownArgument(tool);
  const schema = tool.inputSchema as ObjectSchema;
  if (
    !owned &&
    (schema.type !== "object" || "purpose" in (schema.properties ?? {}))
  )
    return { args, said: {} };
  const { purpose, ...own } = args;
  const limit =
    owned && typeof owned.maxLength === "number"
      ? owned.maxLength
      : guidanceTextLimits.description;
  const sentence =
    typeof purpose === "string" && purpose.trim()
      ? purpose.trim().replace(/\s+/g, " ").slice(0, limit)
      : undefined;
  return {
    args: owned ? args : own,
    said: sentence ? { purpose: sentence } : {},
  };
}

/**
 * The tool as the model is shown it: without the other names its schema
 * reads as its fields, which only the loop reads.
 */
export function shownSchema(tool: ToolSpec): ToolSpec {
  if (!Object.hasOwn(tool.inputSchema, readAsKey)) return tool;
  const inputSchema = Object.fromEntries(
    Object.entries(tool.inputSchema).filter(([key]) => key !== readAsKey),
  );
  return { ...tool, inputSchema };
}

/** The tool's own `purpose`, when its input has one. */
function ownArgument(
  tool: ToolSpec,
): { readonly maxLength?: unknown } | undefined {
  const schema = tool.inputSchema as ObjectSchema;
  const property =
    schema.type === "object" ? schema.properties?.["purpose"] : undefined;
  return property && typeof property === "object" ? property : undefined;
}
