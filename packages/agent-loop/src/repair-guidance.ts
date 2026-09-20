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
 * So a small model is asked first, with a deliberately narrow view: the failing
 * call, the reason it was refused, and the last few actions with their observed
 * results — not the transcript. That is usually enough, because the evidence
 * that fixes a stale `find` is the file the previous action already read.
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

const limits = {
  /** Beyond this the failing call is too large to repair from a summary. */
  arguments: 4_000,
  reason: 600,
  intent: 300,
  recentCalls: 3,
  evidencePerCall: 1_200,
  total: 9_000,
} as const;

export const repairLimits = limits;

export type RepairObservation = {
  readonly action: string;
  readonly target: string;
  readonly status: string;
  readonly evidence?: string | undefined;
};

export type RepairContextInput = {
  readonly userIntent: string;
  readonly toolName: string;
  readonly toolDescription: string;
  readonly failedArguments: string;
  readonly reason: string;
  readonly preserve: readonly string[];
  readonly recent: readonly RepairObservation[];
};

export type RepairDecision =
  | { readonly kind: "repair"; readonly arguments: Record<string, unknown> }
  | { readonly kind: "handover"; readonly reason?: string };

function clamp(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

/**
 * The request the small model answers, or nothing when the call is too large to
 * describe honestly. A truncated call must not be repaired: the model would be
 * proposing arguments it never fully saw.
 */
export function repairContextLines(
  input: RepairContextInput,
): string[] | undefined {
  if (input.failedArguments.length > limits.arguments) return undefined;

  const recent = input.recent.slice(-limits.recentCalls).map((item) => ({
    action: item.action,
    target: item.target,
    status: item.status,
    ...(item.evidence
      ? { observed: clamp(item.evidence, limits.evidencePerCall) }
      : {}),
  }));

  const lines = [
    "A tool refused this call. Repair it if you can tell exactly what was meant; otherwise hand it back.",
    `You may change how the call is aimed. You must not change these fields, wherever they appear: ${
      input.preserve.length ? input.preserve.join(", ") : "none"
    }. A repair that alters them is discarded.`,
    "Repair only from the evidence below. Do not invent file contents, paths, or text you have not been shown.",
    "Hand back whenever the evidence does not settle it — an ambiguity you would have to guess at, a file you have not seen, or a reason you do not understand. Handing back is the correct answer more often than not.",
    'Return {"action":"repair","arguments":{…}} or {"action":"handover","reason":"…"}.',
    `Task: ${clamp(input.userIntent, limits.intent)}`,
    `Tool: ${input.toolName} — ${input.toolDescription}`,
    `Refused call: ${input.failedArguments}`,
    `Reason given: ${clamp(input.reason, limits.reason)}`,
    `Recent actions and what they observed: ${JSON.stringify(recent)}`,
  ];

  const size = lines.reduce((total, line) => total + line.length + 1, 0);
  if (size <= limits.total) return lines;
  // Drop observations oldest-first rather than truncating any one of them.
  for (let keep = recent.length - 1; keep >= 0; keep -= 1) {
    const trimmed = [
      ...lines.slice(0, -1),
      `Recent actions and what they observed: ${JSON.stringify(recent.slice(-keep))}`,
    ];
    if (
      trimmed.reduce((total, line) => total + line.length + 1, 0) <=
      limits.total
    )
      return trimmed;
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
