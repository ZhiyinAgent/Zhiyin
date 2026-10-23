/**
 * A tool call, laid out so a person can read what was asked for.
 *
 * Every tool call passes through here, whatever tool it is and whoever wrote
 * it. A tool that describes its own effects well is still described here,
 * because "what was called, and with what" is a different question from "what
 * did it do", and the interface decides which of the two to show.
 *
 * Every value is kept whole, however long. A call waiting for approval is
 * shown whole because what a person allows is what runs, and a part they could
 * not see is a part they did not allow. The record keeps it whole because,
 * once the model's own copy of the call is condensed away, the record is the
 * only account left of what the call was given.
 */

import type { ToolInvocation } from "@zhiyin/contract";

/** Strips the routing prefix an MCP tool carries, leaving the tool's own name. */
export function readableToolName(name: string): string {
  const routed = /^mcp__(.+?)__(.+)$/.exec(name);
  return routed ? (routed[2] as string) : name;
}

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The arguments as the model sent them. Invalid JSON is not hidden: what was
 * actually sent is what a person needs to see when a call failed to parse.
 */
export function describeInvocation(
  name: string,
  rawArguments: string,
  via?: string,
): ToolInvocation {
  let parsed: unknown;
  try {
    parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    return {
      name: readableToolName(name),
      ...(via ? { via } : {}),
      arguments: [{ name: "Unreadable input", value: rawArguments.trim() }],
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      name: readableToolName(name),
      ...(via ? { via } : {}),
      arguments:
        parsed === undefined
          ? []
          : [{ name: "Input", value: jsonText(parsed) }],
    };
  }
  return {
    name: readableToolName(name),
    ...(via ? { via } : {}),
    arguments: Object.entries(parsed).map(([key, value]) => ({
      name: key,
      value: jsonText(value),
    })),
  };
}
