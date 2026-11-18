/**
 * Instructions are written a rule at a time, each on a line of its own, and
 * each resting on words the person wrote (ADR 0026).
 */

/** Text as compared: one space between words, composed the same way. */
function plainText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Whether the person wrote `quote`, word for word, in one of their messages. */
export function personWrote(
  quote: string,
  personsWords: readonly string[],
): boolean {
  const wanted = plainText(quote);
  return (
    wanted.length > 0 &&
    personsWords.some((words) => plainText(words).includes(wanted))
  );
}

/** A rule as written in the text, without the dash that lists it. */
function ruleOf(line: string): string {
  return plainText(line.replace(/^\s*[-*•]\s+/, ""));
}

/** The rules an instruction's text holds, one a line. */
export function rulesOf(text: string): string[] {
  return text.split(/\r?\n/).map(ruleOf).filter(Boolean);
}

/** Where the line holding `rule` is in `text`, or -1; a blank rule is in none. */
function lineOf(text: string, rule: string): number {
  const wanted = plainText(rule);
  if (!wanted) return -1;
  return text.split(/\r?\n/).findIndex((line) => ruleOf(line) === wanted);
}

export function holdsRule(text: string, rule: string): boolean {
  return lineOf(text, rule) >= 0;
}

/**
 * The text with `rule` added on a line of its own, or put in the place of
 * `replaces`; with no rule, `replaces` is taken out. Nothing when `replaces`
 * is not there.
 */
export function withRule(
  text: string,
  change: {
    readonly rule?: string | undefined;
    readonly replaces?: string | undefined;
  },
): string | undefined {
  const lines = text ? text.split(/\r?\n/) : [];
  const rule = change.rule?.trim();
  if (change.replaces === undefined) {
    if (!rule) return text;
    return [...trimmedEnd(lines), `- ${rule}`].join("\n");
  }
  const at = lineOf(text, change.replaces);
  if (at < 0) return undefined;
  const kept = rule
    ? lines.with(
        at,
        lines[at]!.replace(
          /^(\s*[-*•]\s+)?.*$/,
          (_, dash: string | undefined) => `${dash ?? "- "}${rule}`,
        ),
      )
    : lines.filter((_, index) => index !== at);
  return trimmedEnd(kept).join("\n");
}

function trimmedEnd(lines: readonly string[]): string[] {
  const kept = [...lines];
  while (kept.length && !kept.at(-1)!.trim()) kept.pop();
  return kept;
}
