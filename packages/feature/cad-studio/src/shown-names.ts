/**
 * The names a build script gives the parts it shows, read from its code, so
 * an approval can say what a script written for one call builds. Only names
 * written out in quotes are found; a name the script computes is not.
 */

/** Each name passed as `name="…"` to show() or show_object(), in order, once each. */
export function shownNames(code: string): string[] {
  const names: string[] = [];
  for (const call of code.matchAll(/\bshow(?:_object)?\(/g)) {
    const inside = argumentsFrom(code, call.index + call[0].length);
    const named = /(?:^|[\s,(])name\s*=\s*(["'])([^"'\n]{1,80})\1/.exec(inside);
    if (named && !names.includes(named[2]!)) names.push(named[2]!);
  }
  return names;
}

/** The text of a call's arguments, from just inside its bracket to the one that closes it. */
function argumentsFrom(code: string, start: number): string {
  let depth = 1;
  let quote: string | undefined;
  for (let at = start; at < code.length; at++) {
    const char = code[at]!;
    if (quote) {
      if (char === "\\") at++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") {
      depth--;
      if (depth === 0) return code.slice(start, at);
    }
  }
  return code.slice(start);
}

/** Names as a sentence lists them: "A", "A and B", "A, B and C". */
export function listed(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
