/**
 * The warnings LaTeX writes only in its log: references and citations it
 * could not find, fonts it replaced, and what packages warn of. Tectonic
 * prints none of them, only that there were some.
 */

/** The width at which TeX breaks a log line, carrying the rest to the next. */
const logWidth = 79;

const warningStart = /^(?:LaTeX(?: \S+)?|Package \S+|Class \S+) Warning: /;

/**
 * Each warning in a log, once, as one line: TeX's breaks at its line width
 * joined back, and a warning's own continuation lines, such as "(Font)
 * using …", joined with a space.
 */
export function logWarnings(log: string): readonly string[] {
  const lines = log.split(/\r?\n/);
  const found: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!warningStart.test(lines[index]!)) continue;
    let warning = lines[index]!;
    let previous = warning;
    while (index + 1 < lines.length && lines[index + 1]!.trim() !== "") {
      index += 1;
      const next = lines[index]!;
      warning =
        previous.length === logWidth
          ? `${warning}${next}`
          : `${warning} ${next.replace(/^\(\S+\)\s+/, "").trim()}`;
      previous = next;
    }
    if (!found.includes(warning)) found.push(warning);
  }
  return found;
}

/**
 * Tectonic's advice to read its log, which a model cannot follow: Zhiyin
 * reads the log itself.
 */
export function isLogAdvice(line: string): boolean {
  return /were issued by the TeX engine; use --print and\/or --keep-logs/.test(
    line,
  );
}
