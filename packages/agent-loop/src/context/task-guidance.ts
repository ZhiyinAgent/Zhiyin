type ActionLabel = {
  readonly title: string;
  readonly description: string;
};

/**
 * How long each generated field may be, in characters.
 *
 * Exported so the tool schemas declare the same numbers the parsers enforce:
 * a model told the length it is held to writes within it, rather than having
 * a correct answer discarded for its length.
 */
export const guidanceTextLimits = {
  title: 72,
  description: 220,
} as const;

const maximumTitleLength = guidanceTextLimits.title;
const maximumDescriptionLength = guidanceTextLimits.description;

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
