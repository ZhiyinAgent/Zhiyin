/**
 * Repairing a tool call that a tool refused, without spending anyone's turn on
 * it.
 *
 * Most refusals a tool marks correctable are not disagreements about intent.
 * The model meant the right change and expressed it against a slightly stale
 * reading of the file: the text it quoted has moved, or occurs twice, or the
 * path is off by a folder. Handing that back to the main model works, but it
 * costs a full round trip through a large context to fix something small.
 *
 * So a separate call is made first, with a deliberately narrow view: the
 * failing call, the reason it was refused, the tool's schema, what the model
 * said just before it, and the last few calls with their results — not the
 * transcript. That is usually enough, because the evidence that fixes a stale
 * `find` is the file the previous call already read.
 *
 * A call whose input could not be read as JSON is repaired the same way, with
 * one difference: it may only have its syntax fixed, and every text value in
 * the repair must already be in the raw input.
 *
 * Two limits make this safe to do silently.
 *
 * The repair may only re-aim an action, never change what it writes. The tool
 * names the fields that carry content, and a repair whose content fields differ
 * is discarded unexamined.
 *
 * And the repair proposes; it never authorises. A repaired call re-enters at
 * inspection and goes through permission exactly as though the main model had
 * written it. Nothing here can put an action past a person.
 *
 * When the small model cannot tell what was meant, it says so and the main
 * model takes over — which is the behaviour that existed before, reached
 * deliberately instead of by failing.
 */

import type { ModelMessage } from "@zhiyin/model-client";

const limits = {
  /** Beyond this the failing call is too large to repair from a summary. */
  arguments: 4_000,
  reason: 600,
  intent: 300,
  /** What the model said and thought just before the call, from the end. */
  roundTail: 1_500,
  recentCalls: 3,
  /** Each recent call's arguments, and separately its result. */
  evidencePerCall: 1_200,
  total: 14_000,
} as const;

export const repairLimits = limits;

/**
 * Output tokens for the answer alone: the whole arguments written back, at a
 * conservative three characters a token, and the decision around them.
 */
export function answerAllowance(argumentsLength: number): number {
  return Math.ceil(argumentsLength / 3) + 300;
}

/**
 * Output tokens for thinking, when the model cannot be asked not to think. A
 * repair is mechanical; this is room, not an invitation.
 */
export const reasoningAllowance = 2_048;

/** A call from earlier in the conversation, with what came back from it. */
export type RecentCall = {
  readonly name: string;
  readonly arguments: string;
  readonly result: string;
};

/**
 * What a repair is about: a call a tool refused after reading it, or a call
 * whose input could not be read at all.
 */
export type RepairKind = "refused" | "unreadable";

export type RepairContextInput = {
  readonly kind: RepairKind;
  readonly userIntent: string;
  readonly toolName: string;
  readonly toolDescription: string;
  readonly schema: unknown;
  /** The call as refused: its arguments, or its raw text when unreadable. */
  readonly failedArguments: string;
  readonly reason: string;
  readonly preserve: readonly string[];
  readonly roundText: string;
  readonly roundReasoning: string;
  readonly recent: readonly RecentCall[];
};

export type RepairPrompt = { readonly system: string; readonly user: string };

export type RepairDecision =
  | { readonly kind: "repair"; readonly arguments: Record<string, unknown> }
  | { readonly kind: "handover"; readonly reason?: string };

function clamp(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

function tail(value: string, maximum: number): string {
  return value.length > maximum ? `…${value.slice(-maximum)}` : value;
}

/** The last calls in `messages` that have a result, oldest first. */
export function recentCalls(messages: readonly ModelMessage[]): RecentCall[] {
  const proposed = new Map<string, { name: string; arguments: string }>();
  const answered: RecentCall[] = [];
  for (const message of messages) {
    if (message.role === "assistant")
      for (const call of message.toolCalls ?? [])
        proposed.set(call.id, { name: call.name, arguments: call.arguments });
    if (message.role !== "tool") continue;
    const call = proposed.get(message.toolCallId);
    if (call) answered.push({ ...call, result: message.content });
  }
  return answered.slice(-limits.recentCalls);
}

/** The fields the schema names at its top level, when it names any. */
function fieldsOf(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  const properties = (schema as { properties?: unknown }).properties;
  return properties && typeof properties === "object"
    ? Object.keys(properties)
    : [];
}

/**
 * Who the repairer is and what it may do. Its own message, not the shared one
 * for interface copy: it has to know what it is fixing, that it has nothing but
 * this request, and which fields are its to change.
 */
function systemMessage(input: RepairContextInput): string {
  const levers =
    input.kind === "unreadable"
      ? [
          "The call's input could not be read as JSON. You may change only the JSON syntax: quotes, escapes, commas, brackets and braces.",
          "Every text value must keep exactly the characters it has in the raw input. An answer whose text differs from the raw input is discarded.",
        ]
      : [
          `You may change these fields: ${
            fieldsOf(input.schema)
              .filter((field) => !input.preserve.includes(field))
              .join(", ") || "any field not listed as fixed"
          }.`,
          `You must not change these fields, wherever they appear: ${
            input.preserve.join(", ") || "none"
          }. An answer that alters them is discarded.`,
        ];
  return [
    "You repair one tool call that Zhiyin refused, and nothing else.",
    "You have only what this request contains. You have not seen the files or the earlier conversation, and you cannot read, run or ask anything.",
    ...levers,
    "Your answer is checked and inspected again before it is used.",
    "Hand back whenever the evidence does not settle the answer. The model that made the call is then told the reason and fixes it itself, so handing back is always safe.",
    'Answer with record_repair_decision: {"action":"repair","arguments":{…}} or {"action":"handover","reason":"…"}.',
  ].join("\n");
}

/**
 * The request the repairer answers, or nothing when the call is too large to
 * describe honestly. A truncated call must not be repaired: the repairer would
 * be proposing arguments it never fully saw.
 */
export function repairPrompt(
  input: RepairContextInput,
): RepairPrompt | undefined {
  if (input.failedArguments.length > limits.arguments) return undefined;

  const recent = input.recent.slice(-limits.recentCalls).map((call) => ({
    tool: call.name,
    arguments: clamp(call.arguments, limits.evidencePerCall),
    result: clamp(call.result, limits.evidencePerCall),
  }));
  const said = tail(
    [input.roundReasoning.trim(), input.roundText.trim()]
      .filter(Boolean)
      .join("\n"),
    limits.roundTail,
  );

  const system = systemMessage(input);
  const lines = [
    input.kind === "unreadable"
      ? "Zhiyin could not read this call's input. Repair its syntax if you can tell exactly what was meant; otherwise hand it back."
      : "A tool refused this call. Repair it if you can tell exactly what was meant; otherwise hand it back.",
    "Repair only from the evidence below. Do not invent file contents, paths, or text you have not been shown.",
    "Hand back whenever the evidence does not settle it — an ambiguity you would have to guess at, a file you have not seen, or a reason you do not understand. Handing back is the correct answer more often than not.",
    `Task: ${clamp(input.userIntent, limits.intent)}`,
    `Tool: ${input.toolName} — ${input.toolDescription}`,
    `Its input schema: ${JSON.stringify(input.schema ?? {})}`,
    input.kind === "unreadable"
      ? `Raw input, exactly as sent: ${JSON.stringify(input.failedArguments)}`
      : `Refused call: ${input.failedArguments}`,
    `Reason given: ${clamp(input.reason, limits.reason)}`,
    ...(said ? [`What the model said just before the call: ${said}`] : []),
  ];

  const size = (candidate: readonly string[]) =>
    candidate.reduce((total, line) => total + line.length + 1, system.length);
  // Drop recent calls oldest-first rather than truncating any one of them.
  for (let keep = recent.length; keep >= 0; keep -= 1) {
    const trimmed = [
      ...lines,
      `Recent calls and their results: ${JSON.stringify(recent.slice(recent.length - keep))}`,
    ];
    if (size(trimmed) <= limits.total)
      return { system, user: trimmed.join("\n") };
  }
  return undefined;
}

export function repairDecisionFrom(value: string): RepairDecision | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  const record = parsed as Record<string, unknown>;
  if (record["action"] === "handover") {
    const reason = record["reason"];
    return {
      kind: "handover",
      ...(typeof reason === "string" && reason.trim()
        ? { reason: clamp(reason.trim(), limits.reason) }
        : {}),
    };
  }
  if (record["action"] !== "repair") return undefined;
  const args = record["arguments"];
  if (!args || typeof args !== "object" || Array.isArray(args))
    return undefined;
  return { kind: "repair", arguments: args as Record<string, unknown> };
}

/** Every value stored under one of `fields`, in a stable traversal order. */
function valuesUnder(value: unknown, fields: readonly string[]): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (fields.includes(key)) found.push(JSON.stringify(child) ?? "null");
      else visit(child);
    }
  };
  visit(value);
  return found;
}

/**
 * Whether a repair left the content-bearing arguments exactly as they were.
 * Order matters: reordering two replacements changes which text lands where.
 */
export function preservesContent(
  original: unknown,
  repaired: unknown,
  fields: readonly string[],
): boolean {
  if (!fields.length) return true;
  const before = valuesUnder(original, fields);
  const after = valuesUnder(repaired, fields);
  return (
    before.length === after.length &&
    before.every((value, index) => value === after[index])
  );
}

/** Every text value in `value`, keys excluded. */
function textsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(textsIn);
  return [];
}

/** The raw input with its JSON escapes read, wherever the model wrote them. */
function unescaped(raw: string): string {
  const simple: Record<string, string> = {
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
  };
  return raw.replace(
    /\\(?:u([0-9a-fA-F]{4})|([\s\S]))/g,
    (_, code: string | undefined, character: string | undefined) =>
      code
        ? String.fromCharCode(parseInt(code, 16))
        : (simple[character ?? ""] ?? character ?? ""),
  );
}

/**
 * Whether a repair of unreadable input kept its text. There is no object to
 * compare against, so each text value in the repair must appear in the raw
 * input as it was written, or with the escapes the model did write read as
 * JSON reads them. Escaping a quote or a line break passes; changing a single
 * character of content does not.
 */
export function keepsRawText(raw: string, repaired: unknown): boolean {
  const read = unescaped(raw);
  return textsIn(repaired).every(
    (text) => raw.includes(text) || read.includes(text),
  );
}
