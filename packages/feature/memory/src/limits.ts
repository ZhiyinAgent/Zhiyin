/**
 * The limits of each part of memory, in estimated tokens (ADR 0026), and how
 * a write past one is refused so the model can write it again.
 */

import { memoryLimits } from "@zhiyin/contract";
import { estimatedTokens } from "@zhiyin/context-budget";

const counted = (tokens: number) => tokens.toLocaleString("en-US");

/** An entry's line in a list the model is sent. */
export function listLine(
  number: number,
  title: string,
  summary: string,
): string {
  return `#${number} ${title}: ${summary}`;
}

/** Why a Knowledge entry's line is too long for its list, or nothing. */
export function lineTooLong(
  number: number,
  title: string,
  summary: string,
): string | undefined {
  const tokens = estimatedTokens(listLine(number, title, summary));
  return tokens > memoryLimits.line
    ? `The title and summary take about ${counted(tokens)} tokens in the list; the most is ${memoryLimits.line}. Shorten them.`
    : undefined;
}

/** Why a project's line is too long for the Projects list, or nothing. */
export function projectLineTooLong(
  number: number,
  name: string,
  summary: string,
): string | undefined {
  const tokens = estimatedTokens(listLine(number, name, summary));
  return tokens > memoryLimits.projectLine
    ? `The project's name and summary take about ${counted(tokens)} tokens in the Projects list; the most is ${memoryLimits.projectLine}. Shorten the summary.`
    : undefined;
}

/** Why a Knowledge entry's text is too long, or nothing. */
export function entryTooLong(text: string): string | undefined {
  const tokens = estimatedTokens(text);
  return tokens > memoryLimits.entry
    ? `The text takes about ${counted(tokens)} tokens; an entry holds at most ${counted(memoryLimits.entry)}. Keep what will matter later, or split it into entries that link to each other.`
    : undefined;
}

/** Why a brief is too long, or nothing. */
export function briefTooLong(text: string): string | undefined {
  const tokens = estimatedTokens(text);
  return tokens > memoryLimits.brief
    ? `The brief takes about ${counted(tokens)} tokens; a brief holds at most ${counted(memoryLimits.brief)}. Keep where the project stands, not its history.`
    : undefined;
}

/**
 * Why an instruction's new text is too long, or nothing. A change that does
 * not make it longer is let through, so one over its limit can still shrink.
 */
export function instructionsTooLong(
  part: "everything" | "project",
  before: string,
  after: string,
  beside: string,
): string | undefined {
  const limit =
    part === "everything" ? memoryLimits.instructions : memoryLimits.projectHow;
  const tokens =
    estimatedTokens(after) + (beside ? estimatedTokens(beside) : 0);
  if (tokens <= limit || estimatedTokens(after) <= estimatedTokens(before))
    return undefined;
  return part === "everything"
    ? `About you and How to work would take about ${counted(tokens)} tokens; together they hold at most ${counted(limit)}. Fold this into a rule already there, or ask the person which rule can go.`
    : `This project's How to work would take about ${counted(tokens)} tokens; it holds at most ${counted(limit)}. Fold this into a rule already there, or ask the person which rule can go.`;
}

/** Whether a title, summary or rule keeps to one line. */
export function oneLine(...texts: readonly (string | undefined)[]): boolean {
  return texts.every((text) => text === undefined || !/[\r\n]/.test(text));
}
