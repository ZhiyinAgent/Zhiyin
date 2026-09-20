/**
 * How much the auxiliary model is told when it is asked to name an action.
 *
 * This request runs before *every* tool call, so its size is paid on every
 * action of every task. Both directions are real failures, and the budget below
 * is the deliberate answer to both.
 *
 * Too little, and the copy it writes is useless. Given only "Run a shell
 * command" and `npm test`, it cannot know whether that is checking a fix or
 * reproducing a bug, and it writes a title that restates the command. It needs
 * the person's request, the plan it is working through, and enough of the
 * recent actions to avoid describing the same step three times running.
 *
 * Too much, and it is worse than expensive: the whole transcript would put the
 * *content* of the work in front of a model whose only job is to write a label,
 * and it would bury the one action being named among thousands of tokens about
 * other things. Long file contents and tool output are what the main model
 * reads; nothing here needs them.
 *
 * So the budget is shaped rather than merely capped. The essentials — what the
 * person asked for, what this action is, what it touches, what the model says
 * it is for — are always present and never trimmed. Everything else is context
 * that improves the wording, and is dropped oldest-first until the whole thing
 * fits.
 */

const limits = {
  /** Essentials. Never dropped; individually capped. */
  intent: 400,
  action: 80,
  target: 220,
  claim: 300,
  /** Context. Trimmed oldest-first when the whole exceeds `total`. */
  recentActions: 5,
  actionTitle: 72,
  actionTarget: 120,
  actionDescription: 140,
  planTitle: 72,
  planCriterion: 160,
  total: 2_400,
} as const;

export const guidanceLimits = limits;

export type GuidanceAction = {
  readonly action: string;
  readonly description?: string;
  readonly target: string;
};

export type GuidancePlanItem = {
  readonly id: string;
  readonly title: string;
  readonly criterion: string;
};

export type ActionContextInput = {
  readonly userIntent: string;
  readonly action: string;
  readonly target: string;
  /** The model's own account of an action whose arguments cannot show it. */
  readonly claim?: string | undefined;
  readonly earlierActions: readonly GuidanceAction[];
  readonly plan: readonly GuidancePlanItem[];
};

function clamp(value: string, maximum: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > maximum ? `${single.slice(0, maximum)}…` : single;
}

/**
 * The lines the naming request is built from, essentials first, already within
 * budget. Returned as lines rather than one string so the caller composes the
 * instructions and the context without either having to know the other's size.
 */
export function actionContextLines(input: ActionContextInput): string[] {
  const essentials = [
    `Task: ${clamp(input.userIntent, limits.intent)}`,
    `Action: ${clamp(input.action, limits.action)}`,
    `Target: ${clamp(input.target, limits.target)}`,
    ...(input.claim
      ? [
          `Zhiyin's own account of this action, unverified: ${clamp(
            input.claim,
            limits.claim,
          )}`,
        ]
      : []),
  ];

  const plan = input.plan.map((item) => ({
    id: item.id,
    title: clamp(item.title, limits.planTitle),
    criterion: clamp(item.criterion, limits.planCriterion),
  }));

  // Newest last, so trimming from the front drops the least relevant first.
  let earlier = input.earlierActions
    .slice(-limits.recentActions)
    .map((item) => ({
      action: clamp(item.action, limits.actionTitle),
      target: clamp(item.target, limits.actionTarget),
      ...(item.description
        ? { description: clamp(item.description, limits.actionDescription) }
        : {}),
    }));

  const compose = (): string[] => [
    ...essentials,
    `Earlier actions: ${JSON.stringify(earlier)}`,
    `Plan: ${JSON.stringify(plan)}`,
  ];
  const size = (lines: readonly string[]): number =>
    lines.reduce((total, line) => total + line.length + 1, 0);

  while (earlier.length && size(compose()) > limits.total)
    earlier = earlier.slice(1);
  const lines = compose();
  // The plan is the last thing to go, and only if it alone still overflows.
  return size(lines) > limits.total
    ? [...essentials, lines[1] as string]
    : lines;
}
