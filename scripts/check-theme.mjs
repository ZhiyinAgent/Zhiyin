/**
 * The theme is only re-themeable if nothing paints outside the token block.
 *
 * A literal colour in a rule is invisible until the ground changes underneath
 * it, and then it is a bug that no test catches: white-on-white, a wash that
 * darkens what it should lighten, a disabled control that fades into nothing.
 * Swapping this app from a light theme to a dark one turned up exactly those,
 * plus three tokens that were referenced and never defined, so both are checked
 * here rather than left to whoever looks at the right screen next.
 *
 * ESLint does not read CSS, so this stands where a lint rule would.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const styleRoot = join(repositoryRoot, "apps/desktop/src/renderer");

/**
 * The demo stage is the window frame drawn *around* the app for review. It is
 * not product surface and is deliberately not themed with the app's tokens.
 */
const notProductSurface = /[\\/]demo[\\/]/;

const literalColour =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

/** Named colours worth catching. `transparent` and `currentColor` are fine. */
const namedColour =
  /(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple)(?![\w-])/;

/**
 * Blanks comments while keeping every line where it was, so a reported line
 * number still points at the rule. Prose about colour is not a colour.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

async function stylesheets(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await stylesheets(path)));
    else if (entry.name.endsWith(".css")) found.push(path);
  }
  return found;
}

/**
 * The token block is the one place a literal colour belongs. It is found by
 * shape rather than by line number: the first `:root {` block in the file.
 */
function tokenBlockLines(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith(":root"));
  if (start === -1) return new Set();
  const inside = new Set();
  for (let index = start; index < lines.length; index += 1) {
    inside.add(index);
    if (lines[index].trim() === "}") break;
  }
  return inside;
}

const problems = [];
const declared = new Set();
const referenced = new Map();

for (const path of await stylesheets(styleRoot)) {
  if (notProductSurface.test(path)) continue;
  const shown = relative(repositoryRoot, path).replaceAll("\\", "/");
  const text = withoutComments(await readFile(path, "utf8"));
  const tokens = tokenBlockLines(text);

  text.split("\n").forEach((line, index) => {
    for (const [, name] of line.matchAll(/(--zy-[a-z0-9-]+)\s*:/g))
      if (tokens.has(index)) declared.add(name);
    for (const [, name] of line.matchAll(/var\((--zy-[a-z0-9-]+)/g))
      if (!referenced.has(name)) referenced.set(name, `${shown}:${index + 1}`);

    if (tokens.has(index)) return;
    if (literalColour.test(line) || namedColour.test(line))
      problems.push(`${shown}:${index + 1}: literal colour: ${line.trim()}`);
  });
}

for (const [name, where] of referenced)
  if (!declared.has(name))
    problems.push(`${where}: ${name} is used but never defined`);

if (problems.length > 0) {
  console.error("Theme check failed:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nEvery colour belongs in the :root token block. A rule that paints a" +
      "\nliteral cannot follow the theme, and a token that is never defined" +
      "\npaints nothing at all.",
  );
  process.exit(1);
}

console.log(`${declared.size} theme tokens, all defined, no literals outside.`);
