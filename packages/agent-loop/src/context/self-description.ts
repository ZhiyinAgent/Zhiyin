/**
 * What a tool call says about itself: what it is for. One optional argument on
 * every tool, taken off before the tool is handed its input, so no tool ever
 * sees it. ADR 0010.
 *
 * No model call is made before an action to write its label. The purpose is
 * the working model's claim, shown as such; approvals rest on what the code
 * established about the action.
 */

import type { ToolSpec } from "@zhiyin/contract";
import { guidanceTextLimits } from "./task-guidance.js";

/**
 * Bare on purpose: it is added to every tool, so every word here is paid on
 * every request. What it means is said once, in the system prompt.
 */
const arguments_ = { purpose: { type: "string" } } as const;

type ObjectSchema = {
  readonly type?: unknown;
  readonly properties?: Readonly<Record<string, unknown>>;
};

/**
 * The tool as offered, with the argument added. A tool whose own input already
 * uses the name is offered as it is, and keeps its argument.
 */
export function selfDescribing(tool: ToolSpec): ToolSpec {
  const schema = tool.inputSchema as ObjectSchema;
  const properties = schema.properties ?? {};
  if (schema.type !== "object" || "purpose" in properties) return tool;
  return {
    ...tool,
    inputSchema: { ...schema, properties: { ...properties, ...arguments_ } },
  };
}

export type SelfDescription = {
  readonly purpose?: string;
};

/** The call's own input, and what it said about itself. */
export function selfDescription(
  args: Record<string, unknown>,
  tool: ToolSpec | undefined,
): { readonly args: Record<string, unknown>; readonly said: SelfDescription } {
  if (!tool || selfDescribing(tool) === tool) return { args, said: {} };
  const { purpose, ...own } = args;
  const sentence =
    typeof purpose === "string" && purpose.trim()
      ? purpose
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, guidanceTextLimits.description)
      : undefined;
  return { args: own, said: sentence ? { purpose: sentence } : {} };
}
