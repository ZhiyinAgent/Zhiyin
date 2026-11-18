/**
 * Finding text by a pattern the model wrote, a JavaScript regular expression.
 *
 * A pattern is code of a kind: one that backtracks without end would hold the
 * app while it searched. So it runs in a context of its own with a time
 * limit, and one that takes longer is refused rather than waited for.
 */

import { createContext, runInContext } from "node:vm";

/** Long enough for any pattern on a file an edit may change, short of a hang. */
const searchTimeMs = 2_000;

export type PatternMatch =
  /** Each place matched, and the text its replacement puts there. */
  | {
      readonly kind: "found";
      readonly targets: readonly {
        readonly start: number;
        readonly length: number;
        readonly text: string;
      }[];
    }
  | { readonly kind: "none" }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Every place `pattern` matches in `text`, in order, with what `replace`
 * expands to at each: `$1` or `$<name>` for what a group matched, `$&` for
 * the whole match. `^` and `$` match at each line; `.` does not match a line
 * ending. Each expansion is made on the whole text, so lookarounds see it.
 */
export function findPattern(
  text: string,
  pattern: string,
  replace: string,
): PatternMatch {
  const context = createContext({ text, pattern, replace });
  let found: { start: number; length: number; text: string }[] | string;
  try {
    found = runInContext(
      `(() => {
        let search;
        try { search = new RegExp(pattern, "gm"); }
        catch (error) { return String(error.message); }
        // As String.prototype.replace expands its replacement for one match.
        const expand = (match) => {
          const groups = match.length - 1;
          let out = "";
          for (let i = 0; i < replace.length; i += 1) {
            const c = replace[i];
            const next = replace[i + 1];
            if (c !== "$" || next === undefined) { out += c; continue; }
            if (next === "$") { out += "$"; i += 1; continue; }
            if (next === "&") { out += match[0]; i += 1; continue; }
            if (next === "\`") { out += text.slice(0, match.index); i += 1; continue; }
            if (next === "'") { out += text.slice(match.index + match[0].length); i += 1; continue; }
            if (next >= "0" && next <= "9") {
              const two = replace.slice(i + 1, i + 3);
              if (/^\\d\\d$/.test(two) && Number(two) >= 1 && Number(two) <= groups) {
                out += match[Number(two)] ?? ""; i += 2; continue;
              }
              if (Number(next) >= 1 && Number(next) <= groups) {
                out += match[Number(next)] ?? ""; i += 1; continue;
              }
              out += c; continue;
            }
            if (next === "<" && match.groups) {
              const close = replace.indexOf(">", i + 2);
              if (close !== -1) {
                out += match.groups[replace.slice(i + 2, close)] ?? "";
                i = close; continue;
              }
            }
            out += c;
          }
          return out;
        };
        const targets = [];
        for (const match of text.matchAll(search)) {
          if (match[0] === "") return "";
          targets.push({ start: match.index, length: match[0].length, text: expand(match) });
        }
        return targets;
      })()`,
      context,
      { timeout: searchTimeMs },
    ) as typeof found;
  } catch {
    return {
      kind: "refused",
      reason: `The pattern took too long to search, more than ${searchTimeMs / 1000} seconds, so it was stopped. Write one that does not repeat a repetition, such as (a+)+, or replace exact text.`,
    };
  }
  if (found === "")
    return {
      kind: "refused",
      reason:
        "The pattern matches empty text, so it would insert rather than replace. Make it match at least one character.",
    };
  if (typeof found === "string")
    return {
      kind: "refused",
      reason: `The find text is not a valid pattern: ${found}.`,
    };
  // Made in another context, so copied into plain values of this one.
  const targets = Array.from(found, (target) => ({
    start: Number(target.start),
    length: Number(target.length),
    text: String(target.text),
  }));
  return targets.length ? { kind: "found", targets } : { kind: "none" };
}
