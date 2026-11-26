/**
 * The bridge to an opened toolkit on a lab that cannot load tools while a
 * conversation runs (ADR 0017): one tool, `call`, whose own schema never
 * changes, runs an opened tool by name. The call is answered as a direct call
 * to that tool would be, its input read, inspected and approved the same way,
 * and the conversation keeps it as the `call` the model made, by the tool's
 * whole name when a short one was read as it.
 */

import type { ToolSpec } from "@zhiyin/contract";
import type { Unwrapped } from "../round/round-answers.js";
import type { Transcript } from "../round/transcript.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import { refusal, unknownTool, unreadableInput } from "./refusals.js";
import { readToolInput } from "./tool-input.js";

const callToolName = "call";

export const callTool: ToolSpec = {
  name: callToolName,
  description:
    "Run a tool of a toolkit you opened: name is the tool, arguments its input as the toolkit's schema gives it, purpose included.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The tool's name." },
      arguments: { type: "object", description: "The tool's input." },
    },
    required: ["name", "arguments"],
    additionalProperties: false,
  },
};

/** The inner input as text a call carries: an object written out, a text as it came. */
function innerText(value: unknown, purpose: unknown): string | undefined {
  if (value === undefined) return "{}";
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  // A purpose given beside the inner input is the inner call's.
  return JSON.stringify(
    typeof purpose === "string" && !("purpose" in value)
      ? { ...value, purpose }
      : value,
  );
}

/** The outer call's arguments, wrapping the inner input as it now stands. */
function wrapped(name: string, args: string): string {
  let inner: unknown = args;
  try {
    inner = JSON.parse(args);
  } catch {
    // Text that does not read stays text.
  }
  return JSON.stringify({ name, arguments: inner });
}

/** The conversation's record of the inner call, kept as the outer one. */
function asOuter(base: Transcript, name: string): Transcript {
  return {
    round: (...round) => base.round(...round),
    result: (call, content, runId) =>
      base.result({ callId: call.callId, name: callToolName }, content, runId),
    rewriteCall: (callId, args) =>
      base.rewriteCall(callId, wrapped(name, args)),
    forget: (callIds) => base.forget(callIds),
    endRound: () => base.endRound(),
  };
}

/**
 * The call to the opened tool a `call` names, or what the model is answered
 * instead: input that does not read, or a tool it cannot reach this way.
 * `known` says whether a name is on offer or loads with a toolkit, and whether
 * it is one of Zhiyin's own tools, which are called directly.
 */
export function unwrapBridged(
  call: AssembledToolCall,
  known: {
    readonly has: (name: string) => boolean;
    readonly names: () => readonly string[];
    readonly own: (name: string) => boolean;
  },
): Unwrapped | undefined {
  if (call.name !== callToolName) return undefined;
  const outer = readToolInput(call.arguments);
  if (!outer.ok)
    return {
      refused: unreadableInput(
        outer.reason,
        outer.cutOff,
        call.arguments.length,
      ),
    };
  const { name: given, arguments: inner, purpose } = outer.arguments;
  // A model that writes its calls out can run a tool's name on into its own
  // call markup, the arguments inside it. They are not taken from there: what
  // is run is what the model sent in the call's own fields.
  const head =
    typeof given === "string"
      ? /^[\w.-]+(?=["'<>\s])/.exec(given)?.[0]
      : undefined;
  if (head && known.has(head))
    return {
      refused: refusal(
        "input-check",
        `The name runs on past “${head}” into call markup.`,
        "Send call again with the tool's name alone in name and its input as an object in arguments.",
      ),
    };
  const args = innerText(inner, purpose);
  if (
    typeof given !== "string" ||
    !given.trim() ||
    given === callToolName ||
    args === undefined
  )
    return {
      refused: refusal(
        "input-check",
        "call takes the tool's name in name and its input as an object in arguments.",
        "Send call again with both.",
      ),
    };
  const resolved = wholeName(given, known);
  if ("refused" in resolved) return resolved;
  const { name } = resolved;
  if (known.own(name))
    return {
      refused: refusal(
        "input-check",
        `${name} is called directly, not through call.`,
        `Call ${name} itself.`,
      ),
    };
  if (!known.has(name)) {
    const unknown = unknownTool(name, known.names());
    return {
      refused: refusal(
        "input-check",
        unknown.reason,
        "Find the toolkit it belongs to with find, open it, then call the tool.",
      ),
    };
  }
  return {
    call: {
      index: call.index,
      callId: call.callId,
      name,
      arguments: args,
      ...(name !== given ? { corrections: [`${given} read as ${name}`] } : {}),
    },
    transcript: (base) => asOuter(base, name),
  };
}

/**
 * The tool a `call` names: the name itself when it is known, or the one
 * offered tool whose name ends with it after a connection's prefix, as
 * `tavily_search` ends `mcp__tavily__tavily_search`. A short name that ends
 * several is refused, naming them; one that ends none is left for the
 * refusal of a name nothing offers.
 */
function wholeName(
  given: string,
  known: {
    readonly has: (name: string) => boolean;
    readonly names: () => readonly string[];
  },
): { readonly name: string } | { readonly refused: object } {
  if (known.has(given)) return { name: given };
  const ending = known.names().filter((name) => name.endsWith(`__${given}`));
  if (ending.length === 1) return { name: ending[0]! };
  if (ending.length === 0) return { name: given };
  const listed = `${ending.slice(0, -1).join(", ")} or ${ending.at(-1)!}`;
  return {
    refused: refusal(
      "input-check",
      `“${given}” could be ${listed}.`,
      "Send call again with the tool's whole name in name.",
    ),
  };
}
