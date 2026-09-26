/**
 * What the judge is shown. ADR 0053.
 *
 * The record is this turn's calls, kept by the code as they run: what was
 * called, with what, for which plan item, and what came back as the working
 * model saw it. No model writes it. A criterion is judged against this turn's
 * work only; earlier turns had their own plans.
 *
 * The judge used to see every action in the conversation, each cut to 600
 * characters and the list cut to 4,000 from the middle, so in a 20-call turn
 * it saw the first and last few and missed the calls that did the work. Now a
 * call is shown whole or not at all, most relevant first, and a call left out
 * is named with how to open it.
 */

import { estimatedTokens, type TaskPlanItem } from "@zhiyin/contract";

/** One call of the turn, as the judge can be shown it. */
export type JudgedCall = {
  readonly callId: string;
  readonly tool: string;
  /** The tool's own input, without `purpose` and `plan_item`. */
  readonly args: Record<string, unknown>;
  readonly planItem?: string;
  readonly purpose?: string;
  /** What the working model was sent back, once the call has answered. */
  result?: string;
};

/** The marker every review request opens with. */
export const reviewOpening = "Review whether each plan criterion is met.";

/** The share of the conversation's budget target the evidence may fill. */
export const evidenceShare = 0.15;

/** One call as the judge reads it. */
export function callText(call: JudgedCall): string {
  const said = [
    `id="${call.callId}"`,
    `tool="${call.tool}"`,
    ...(call.planItem ? [`plan_item="${call.planItem}"`] : []),
  ].join(" ");
  return [
    `<call ${said}>`,
    ...(call.purpose ? [`purpose (the worker's words): ${call.purpose}`] : []),
    `input: ${JSON.stringify(call.args)}`,
    `result: ${call.result ?? "(no result: the call did not finish)"}`,
    "</call>",
  ].join("\n");
}

function claimText(item: TaskPlanItem): string {
  const progress = item.progress ?? "pending";
  const cited = (item.evidence ?? [])
    .map((entry) => `${entry.callId}: ${entry.shows}`)
    .join("; ");
  return `  The worker's claim, not evidence: ${progress.replace("_", " ")}${
    cited ? `, citing ${cited}` : ""
  }.`;
}

/**
 * The review request's text: the person's request, each item with its
 * criterion and the worker's claim, then the evidence within `budget` tokens.
 */
export function reviewPrompt(options: {
  readonly request: string;
  readonly items: readonly TaskPlanItem[];
  readonly calls: readonly JudgedCall[];
  readonly finalAnswer?: string;
  readonly budget: number;
}): string {
  const { items, calls, budget } = options;
  const ids = new Set(items.map((item) => item.id));
  const cited = new Set(
    items.flatMap((item) => (item.evidence ?? []).map((entry) => entry.callId)),
  );
  const linked = (call: JudgedCall) =>
    call.planItem !== undefined && ids.has(call.planItem);
  const ordered = [
    ...calls.filter((call) => cited.has(call.callId)),
    ...calls.filter((call) => !cited.has(call.callId) && linked(call)),
  ];
  const rest = calls.filter((call) => !ordered.includes(call));

  let room = budget;
  const shown: string[] = [];
  const left: JudgedCall[] = [];
  const offer = (call: JudgedCall) => {
    const text = callText(call);
    const cost = estimatedTokens(text);
    if (cost > room) return void left.push(call);
    room -= cost;
    shown.push(text);
  };
  ordered.forEach(offer);
  let answer: string | undefined;
  if (options.finalAnswer !== undefined) {
    const text = `The worker's final answer:\n${options.finalAnswer || "(no text)"}`;
    const cost = estimatedTokens(text);
    if (cost <= room) {
      room -= cost;
      answer = text;
    } else
      answer =
        "The worker's final answer is too long to show here; judge from the calls.";
  }
  rest.forEach(offer);

  return [
    reviewOpening,
    `The person asked: ${options.request}`,
    "Items to judge:",
    ...items.flatMap((item) => [
      `- ${item.id}: ${item.title}`,
      `  Criterion: ${item.criterion}`,
      claimText(item),
    ]),
    "",
    calls.length
      ? "This turn's calls, most relevant first. A result is what the tool answered. A tool saying it saved or wrote something is not proof that it did: open the file."
      : "No tool was called this turn.",
    ...shown,
    ...(left.length
      ? [
          `Not shown for room: ${left
            .map((call) => `${call.callId} (${call.tool})`)
            .join(", ")}. Open any of them with open_call.`,
        ]
      : []),
    ...(answer ? ["", answer] : []),
    "",
    "Judge each item against its criterion only. The worker's claim tells you where to look; it proves nothing. Where the calls do not settle a criterion, check it yourself with the tools you have.",
    "Call record_verdicts with one entry for every item: verified, naming the call ids relied on; not-verified, naming what is missing; or couldnt-judge, saying why.",
  ].join("\n");
}
