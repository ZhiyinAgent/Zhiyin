/**
 * Which checks a change needs, from the paths it touches: "docs" when every
 * one is documentation that neither the app nor a test or check reads beyond
 * the repository tests, "full" otherwise. CI and the commit hook run
 * `gate.ps1 -Docs` for the first and the whole gate for the second.
 *
 *   git diff --name-only --no-renames <base> HEAD | node scripts/change-scope.mjs
 *
 * Prints the scope. An empty list is "full": nothing then says what changed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Documentation, by path. Markdown inside `packages/` is read by the app or
 * its tests, and `THIRD_PARTY_LICENSES.md` ships in the installer, so neither
 * is here.
 */
const documentation = [
  /^(README|CHANGELOG|AGENTS|CLAUDE)\.md$/,
  /^docs\//,
  /^\.github\/[^/]+\.md$/,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/assets\//,
];

/** @param {readonly string[]} paths @returns {"docs" | "full"} */
export function changeScope(paths) {
  const changed = paths.map((path) => path.trim()).filter(Boolean);
  return changed.length > 0 &&
    changed.every((path) => documentation.some((rule) => rule.test(path)))
    ? "docs"
    : "full";
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(changeScope(readFileSync(0, "utf8").split("\n")));
