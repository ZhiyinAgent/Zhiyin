/**
 * A tool call, laid out so a person can read what was asked for.
 *
 * Every tool call passes through here, whatever tool it is and whoever wrote
 * it. A tool that describes its own effects well is still described here,
 * because "what was called, and with what" is a different question from "what
 * did it do", and the interface decides which of the two to show.
 *
 * Values are bounded from the middle rather than the end. The start of a value
 * says what it is and the end says where it stops; cutting the tail off a long
 * argument leaves a reader unable to tell a complete value from a clipped one.
 */

import type { ToolInvocation } from "@zhiyin/contract";

/** Long enough to read an argument by; short enough not to be a second copy. */
const maximumValueCharacters = 2000;

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

/** Keeps both ends, and says exactly how much of the middle went missing. */
function boundValue(text: string): {
  readonly value: string;
  readonly omitted?: number;
} {
  if (text.length <= maximumValueCharacters) return { value: text };
  const half = Math.floor(maximumValueCharacters / 2);
  return {
    value: `${text.slice(0, half)}${text.slice(text.length - half)}`,
    omitted: text.length - half * 2,
  };
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
      arguments: [
        { name: "Unreadable input", ...boundValue(rawArguments.trim()) },
      ],
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      name: readableToolName(name),
      ...(via ? { via } : {}),
      arguments:
        parsed === undefined
          ? []
          : [{ name: "Input", ...boundValue(jsonText(parsed)) }],
    };
  }
  return {
    name: readableToolName(name),
    ...(via ? { via } : {}),
    arguments: Object.entries(parsed).map(([key, value]) => ({
      name: key,
      ...boundValue(jsonText(value)),
    })),
  };
}
