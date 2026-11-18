import { boundedText, recordFrom } from "./generated-fields.js";

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

/**
 * A workspace read or listing names its target in its title. Only these
 * generic titles are made specific: a pattern over any title would rename
 * other actions that happen to name a reader or a list.
 */
const namesItsTarget: Readonly<Record<string, string>> = {
  "read a workspace file": "Read",
  "read a workspace document": "Read",
  "list a workspace directory": "List",
};

function specificTitle(action: string, target: string): string {
  const verb = namesItsTarget[action.toLowerCase()];
  if (verb && target) {
    const named = /^workspace root$/i.test(target)
      ? "the workspace root"
      : target;
    return `${verb} ${named}`.slice(0, maximumTitleLength);
  }
  return action.slice(0, maximumTitleLength);
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
    // A template sentence with the target spliced in says less than the title
    // and target do, and reads as a fact about the person's goal.
    description: "",
  };
}
