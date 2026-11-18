/**
 * A script's error or warnings met with the known API change they come from
 * (ADR 0024): the form that works in the version installed, and the pages to
 * read. A failed script's error is met too with what fixes it when the
 * library's words mislead: a CadQuery habit, a name only a later release
 * has, or the geometry kernel's failure.
 */

import { matchBreaks } from "@zhiyin/catalog-search";
import { cadBreaks } from "./api-breaks.js";
import { allLaterNames, laterAnswer } from "./later-names.js";
import { versionWords } from "./library-versions.js";
import {
  cadQueryHabits,
  kernelErrors,
  type ScriptHint,
} from "./script-habits.js";

/** One line for each known change `said` shows, in the table's order. */
export function breakLines(said: string): string[] {
  return matchBreaks(cadBreaks, said).map(
    (one) =>
      `${versionWords("build123d")} changed this: write ${one.right}, in place of ${one.wrong}. To read more, open ${one.see.join(" or ")}.`,
  );
}

const matches = (hint: ScriptHint, said: string) =>
  new RegExp(hint.pattern).test(said);

const line = (hint: ScriptHint) =>
  hint.see
    ? `${hint.says} To read more, open ${hint.see.join(" or ")}.`
    : hint.says;

/** The ways a script's error names something a library lacks. */
const lacking = new RegExp(
  String.raw`name '(${allLaterNames.join("|")})' is not defined|cannot import name '(${allLaterNames.join("|")})'|has no attribute '(${allLaterNames.join("|")})'`,
  "g",
);

/**
 * What fixes a failed script's error, one line each: the CadQuery habits it
 * shows, the names only a later release has, each once, and the kernel's
 * failure it is, the most particular one known.
 */
export function hintLines(failed: string): string[] {
  const later = [
    ...new Set(
      [...failed.matchAll(lacking)].map((one) => one.slice(1).find(Boolean)!),
    ),
  ].flatMap((name) => laterAnswer(name) ?? []);
  const kernel = kernelErrors.filter((hint) => matches(hint, failed));
  const particular = kernel.filter((hint) => hint.id !== "kernel");
  return [
    ...cadQueryHabits.filter((hint) => matches(hint, failed)).map(line),
    ...later,
    ...(particular.length ? particular : kernel).map(line),
  ];
}
