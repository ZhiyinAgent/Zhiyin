import type { TaskPlanItem } from "@zhiyin/contract";

type ActionLabel = {
  readonly title: string;
  readonly description: string;
};

const maximumPlanItems = 4;

/**
 * How long each generated field may be, in characters.
 *
 * Exported so the tool schemas declare the same numbers the parsers enforce.
 * They were apart once, and the schemas stated no limit at all: a model was
 * never told the length it was being held to, and a correct verdict explained
 * in three sentences was discarded for saying so at length.
 */
export const guidanceTextLimits = {
  title: 72,
  description: 220,
  criterion: 240,
  summary: 220,
} as const;

const maximumTitleLength = guidanceTextLimits.title;
const maximumDescriptionLength = guidanceTextLimits.description;
const maximumCriterionLength = guidanceTextLimits.criterion;
const maximumSummaryLength = guidanceTextLimits.summary;

function recordFrom(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Text kept whole or not at all.
 *
 * Right where running long means the model misread the request rather than
 * answered it at length. A 300-character "two-to-six-word verb phrase" is not
 * a long title, it is a sentence, and the first 72 characters of a sentence
 * are worse copy than the specific fallback that stands beside it.
 */
function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  return text && text.length <= maximum ? text : undefined;
}

/**
 * Text kept, shortened when long.
 *
 * Right where the answer is what matters and its length is incidental. These
 * were bounded once, so a verdict of "satisfied" arriving with a thorough
 * explanation was read as no verdict at all and the item it belonged to was
 * shown as unresolved — the model having answered correctly throughout.
 */
function clampedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return undefined;
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

/**
 * The plan, or nothing.
 *
 * An empty list is an answer, not a failure: a request the reply itself
 * answers has no work to show. It reads the same as a malformed plan here
 * because both mean "display no plan", and neither invents one.
 */
export function planFrom(value: string): TaskPlanItem[] | undefined {
  const record = recordFrom(value);
  if (!Array.isArray(record?.["items"])) return undefined;
  const items = record["items"];
  if (items.length < 1 || items.length > maximumPlanItems) return undefined;

  const plan = items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const source = item as Record<string, unknown>;
    // Shortened rather than refused: one wordy item used to discard the whole
    // plan, leaving the person with no plan at all instead of a long line.
    const title = clampedText(source["title"], maximumTitleLength);
    const criterion = clampedText(source["criterion"], maximumCriterionLength);
    if (!title || !criterion) return;
    return {
      id: `plan-${index + 1}`,
      title,
      criterion,
      status: index === 0 ? ("active" as const) : ("pending" as const),
    };
  });

  return plan.every((item) => item !== undefined)
    ? (plan as TaskPlanItem[])
    : undefined;
}

function specificTitle(action: string, target: string): string {
  if (/read.+(?:file|workspace)/i.test(action) && target) {
    return `Read ${target}`.slice(0, maximumTitleLength);
  }
  if (/list.+(?:directory|workspace)/i.test(action) && target) {
    return `List ${target.toLowerCase()}`.slice(0, maximumTitleLength);
  }
  return action.slice(0, maximumTitleLength);
}

function specificDescription(action: string, target: string): string {
  if (/list.+(?:directory|workspace)/i.test(action) && target) {
    const describedTarget = /workspace root/i.test(target)
      ? "the workspace root"
      : target.toLowerCase();
    return `Review ${describedTarget} before choosing the next relevant file.`;
  }

  if (/read.+(?:file|workspace)/i.test(action) && target) {
    return `Inspect ${target} for evidence relevant to this task.`;
  }

  // Nothing specific left to say. A template sentence with the target spliced
  // into it says less than the target does on its own, and reads as noise
  // above the thing it is describing — so say nothing and let the action's
  // title and target speak.
  return "";
}

/** The labelling call's answer, or nothing when it lacks either part. */
export function actionLabelFrom(value: string): ActionLabel | undefined {
  const record = recordFrom(value);
  const title = boundedText(record?.["title"], maximumTitleLength);
  const description = boundedText(
    record?.["description"],
    maximumDescriptionLength,
  );
  return title && description ? { title, description } : undefined;
}

/** An action named from what the code knows about it, with no model call. */
export function factsLabel(action: string, target: string): ActionLabel {
  return {
    title: specificTitle(action, target),
    description: specificDescription(action, target),
  };
}

/**
 * The verdict on one criterion.
 *
 * The verdict is the answer and the summary is the reason for it, so the
 * summary is shortened to fit rather than allowed to take the verdict down
 * with it. Only a missing or non-boolean `satisfied` means no answer arrived.
 */
export function criterionEvaluationFrom(
  value: string,
): { readonly satisfied: boolean; readonly summary: string } | undefined {
  const record = recordFrom(value);
  const summary = clampedText(record?.["summary"], maximumSummaryLength);
  return typeof record?.["satisfied"] === "boolean" && summary
    ? { satisfied: record["satisfied"], summary }
    : undefined;
}
