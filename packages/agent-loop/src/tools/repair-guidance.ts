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
 * inputs the refusal is about, the rest of the call shortened, the reason it
 * was refused, the tool's schema, what the model said just before it, and the
 * last few calls with their results — not the transcript. That is usually
 * enough, because the evidence that fixes a stale `find` is the file the
 * previous call already read.
 *
 * Two limits make this safe to do silently.
 *
 * The repair changes only the inputs the refusal names (ADR 0010). The tool
 * names those it vouches for, and the tool's schema names the rest: an input
 * left out, of the wrong kind, or not among the tool's own. Nothing else in the
 * call is sent whole, and nothing else is taken from the answer.
 *
 * And the repair proposes; it never authorises. A repaired call re-enters at
 * inspection and goes through permission exactly as though the main model had
 * written it. Nothing here can put an action past a person.
 *
 * When the small model cannot tell what was meant, it says so and the main
 * model takes over.
 */

import type { ModelMessage } from "@zhiyin/model-client";

const limits = {
  /** Beyond this the inputs at fault are too large to repair from a summary. */
  arguments: 4_000,
  reason: 600,
  intent: 300,
  /** What the model said and thought just before the call, from the end. */
  roundTail: 1_500,
  recentCalls: 3,
  /** Each recent call's arguments, and separately its result. */
  evidencePerCall: 1_200,
  /** Each other input of the refused call, shown for reference. */
  referencePerInput: 200,
  total: 14_000,
} as const;

export const repairLimits = limits;

/**
 * Output tokens for the answer alone: the inputs at fault written back, at a
 * conservative three characters a token, and the decision around them.
 */
export function answerAllowance(faultyLength: number): number {
  return Math.ceil(faultyLength / 3) + 300;
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

/** An input the repair may change, with its value when the call has one. */
type FaultyInput = {
  readonly path: string;
  readonly value?: unknown;
};

export type RepairContextInput = {
  readonly userIntent: string;
  readonly toolName: string;
  readonly toolDescription: string;
  readonly schema: unknown;
  /** The inputs the repair may change. */
  readonly faulty: readonly FaultyInput[];
  /** The refused call, every long text in it shortened. */
  readonly reference: string;
  readonly reason: string;
  readonly roundText: string;
  readonly roundReasoning: string;
  readonly recent: readonly RecentCall[];
};

export type RepairPrompt = { readonly system: string; readonly user: string };

export type RepairDecision =
  | {
      readonly kind: "repair";
      /** A new value for each input it changes, by path. */
      readonly set: Readonly<Record<string, unknown>>;
      /** The inputs it takes out of the call. */
      readonly remove: readonly string[];
    }
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

/**
 * The refused call with every long input shortened, for reference only: a long
 * text, and a list or object below the top whose shortened form is still long,
 * keep their start and say how long they were.
 */
export function shortened(args: unknown): string {
  const cut = (text: string) =>
    text.length > limits.referencePerInput
      ? `${text.slice(0, limits.referencePerInput)}… (${text.length.toLocaleString("en")} characters)`
      : text;
  const shorten = (value: unknown, top: boolean): unknown => {
    if (typeof value === "string") return cut(value);
    if (!value || typeof value !== "object") return value;
    const inner = Array.isArray(value)
      ? value.map((item) => shorten(item, false))
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            shorten(item, false),
          ]),
        );
    if (top) return inner;
    const written = JSON.stringify(inner);
    return written.length > limits.referencePerInput ? cut(written) : inner;
  };
  return JSON.stringify(shorten(args, true));
}

/**
 * Who the repairer is and what it may do. Its own message, not the shared one
 * for interface copy: it has to know what it is fixing, that it has nothing but
 * this request, and which inputs are its to change.
 */
function systemMessage(input: RepairContextInput): string {
  return [
    "You repair one tool call that Zhiyin refused, and nothing else.",
    "You have only what this request contains. You have not seen the files or the earlier conversation, and you cannot read, run or ask anything.",
    `You may change only these inputs of the call, named by where they sit in it: ${input.faulty
      .map((field) => field.path)
      .join(
        ", ",
      )}. Nothing else is taken from your answer, and an answer that names any other input is discarded.`,
    "An input the call should not have may be taken out. A value you give an input the call left out, or one of the wrong kind, must be one the call already holds or one the model wrote in what it said; otherwise your answer is discarded.",
    "Your answer is checked and inspected again before it is used.",
    "Hand back whenever the evidence does not settle the answer. The model that made the call is then told the reason and fixes it itself, so handing back is always safe.",
    'Answer with record_repair_decision: {"action":"repair","fields":{"<input>":<value>},"remove":["<input>"]} or {"action":"handover","reason":"…"}.',
  ].join("\n");
}

/**
 * The request the repairer answers, or nothing when the inputs at fault are too
 * large to describe in full. A truncated input must not be repaired: the
 * repairer would be proposing a value it never fully saw.
 */
export function repairPrompt(
  input: RepairContextInput,
): RepairPrompt | undefined {
  const faulty = JSON.stringify(
    Object.fromEntries(
      input.faulty.map((field) => [
        field.path,
        field.value === undefined ? "(left out)" : field.value,
      ]),
    ),
  );
  if (faulty.length > limits.arguments) return undefined;

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
    "A tool refused this call. Repair it if you can tell exactly what was meant; otherwise hand it back.",
    "Repair only from the evidence below. Do not invent file contents, paths, or text you have not been shown.",
    "Hand back whenever the evidence does not settle it — an ambiguity you would have to guess at, a file you have not seen, or a reason you do not understand. Handing back is the correct answer more often than not.",
    `Task: ${clamp(input.userIntent, limits.intent)}`,
    `Tool: ${input.toolName} — ${input.toolDescription}`,
    `Its input schema: ${JSON.stringify(input.schema ?? {})}`,
    `Inputs you may change, with their values: ${faulty}`,
    `The whole call, long texts shortened, for reference only: ${input.reference}`,
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
  const fields = record["fields"] ?? {};
  const remove = record["remove"] ?? [];
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    return undefined;
  if (
    !Array.isArray(remove) ||
    !remove.every((path) => typeof path === "string")
  )
    return undefined;
  if (!Object.keys(fields).length && !remove.length) return undefined;
  return {
    kind: "repair",
    set: fields as Record<string, unknown>,
    remove: remove as string[],
  };
}
