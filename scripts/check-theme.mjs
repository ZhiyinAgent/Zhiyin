/**
 * The theme can change only if nothing paints outside the token blocks.
 *
 * A literal colour in a rule goes unnoticed until the ground changes underneath
 * it, and then it shows as white on white, a wash that darkens what it should
 * lighten, or a disabled control that fades into nothing. A token that is
 * referenced but never defined paints nothing at all. Both are checked here,
 * so neither waits for someone to look at the right screen.
 *
 * There are two themes, and a colour only one of them defines is the same bug
 * arriving the other way: the light theme would paint it dark. So the dark
 * block and the light block must name the same tokens.
 *
 * Three readability floors are checked with them: no text under 12 px,
 * whatever unit it is written in, every text colour at 4.5:1 or more on every
 * ground of its theme, and every chart mark colour at 3:1 or more. A numbered
 * series, such as the usage dial's fourth model, is drawn only in one of
 * those colours.
 *
 * A stylesheet reads no attribute's value, as a tooltip of its own would to
 * draw its text: hover tips are the window's shared one, so nothing shows
 * two.
 *
 * ESLint does not read CSS, so this stands where a lint rule would.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const lightRule = "@media (prefers-color-scheme: light)";

/**
 * Anything that informs is set at 12 px or more, so every label stays
 * readable.
 */
const smallestText = 12;
/** What a rem is measured against: the page's own text, which nothing sets. */
const rootText = 16;
/** The value of a `font-size` declaration or a `font` shorthand. */
const fontDeclaration = /\bfont(?:-size)?\s*:\s*([^;}]+)/;
const relativeSize =
  /(?<![\w.-])\d*\.?\d+(?:em|%)(?![\w-])|(?<![\w-])(?:xx-small|x-small|small|smaller)(?![\w-])/;

/**
 * What is wrong with a declared text size, if anything. A size in px or rem
 * is measured. One relative to its parent, in em, % or a keyword, cannot be,
 * so it has to hold the floor itself, written as `max(12px, …)`.
 */
function sizeProblem(value) {
  const tooSmall = `text smaller than ${smallestText} px`;
  const floor = value.match(/\bmax\(\s*(\d+(?:\.\d+)?)px\b/);
  if (floor) return Number(floor[1]) < smallestText ? tooSmall : undefined;
  if (relativeSize.test(value))
    return `text sized against its parent; write it as max(${smallestText}px, …)`;
  const px = value.match(/(?<![\d.])(\d+(?:\.\d+)?)px/);
  if (px) return Number(px[1]) < smallestText ? tooSmall : undefined;
  const rem = value.match(/(?<![\w.])(\d*\.?\d+)rem\b/);
  if (rem)
    return Number(rem[1]) * rootText < smallestText ? tooSmall : undefined;
  return undefined;
}

/**
 * The colours text is painted in, and the grounds it is painted on. Each must
 * reach 4.5:1 on each ground of its own theme (WCAG AA for body text).
 */
const textTokens = [
  "--zy-text",
  "--zy-text-soft",
  "--zy-muted",
  "--zy-faint",
  "--zy-accent",
  "--zy-green",
  "--zy-amber",
  "--zy-danger",
  "--zy-running",
  "--zy-provider-openrouter",
  "--zy-provider-anthropic",
  "--zy-provider-deepseek",
  "--zy-provider-moonshot",
  "--zy-provider-minimax",
  "--zy-provider-qwen",
  "--zy-provider-mistral",
];
const groundTokens = [
  "--zy-canvas",
  "--zy-sidebar",
  "--zy-panel",
  "--zy-panel-raised",
  "--zy-panel-soft",
];
const minimumContrast = 4.5;

/**
 * The colours a chart's marks are drawn in, which must stand out at 3:1 on
 * every ground of their theme (WCAG's floor for what is not text).
 */
const markTokens = Array.from(
  { length: 8 },
  (_, index) => `--zy-chart-${index + 1}`,
);
const minimumMarkContrast = 3;
/**
 * A selector for one of a numbered series (`.model-key--3`), whose colour
 * tells that series from the others, so it is one held to a contrast floor.
 */
const numberedSeries = /\.[\w-]+--\d+\b/;

/** Each token a numbered series' rule uses, with the line it is on. */
function seriesTokens(text) {
  const uses = [];
  for (const rule of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!numberedSeries.test(rule[1])) continue;
    const body = rule.index + rule[1].length + 1;
    for (const use of rule[2].matchAll(/var\((--[a-z][a-z0-9-]*)/g))
      uses.push({
        name: use[1],
        line: text.slice(0, body + use.index).split("\n").length,
      });
  }
  return uses;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/**
 * Blanks comments while keeping every line where it was, so a reported line
 * number still points at the rule. Prose about colour is not a colour.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

/** The lines of the block opening on `start`, through its closing brace. */
function blockFrom(lines, start) {
  const inside = new Set();
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    inside.add(index);
    depth += (lines[index].match(/\{/g) ?? []).length;
    depth -= (lines[index].match(/\}/g) ?? []).length;
    if (depth <= 0 && lines[index].includes("}")) break;
  }
  return inside;
}

/**
 * The two theme blocks, found by shape rather than by line number: the first
 * `:root {` block is the dark theme, and the `:root` inside the light media
 * rule is the light one. Any later `:root` holds measurements, not colours.
 */
function themeBlocks(text) {
  const lines = text.split("\n");
  const darkStart = lines.findIndex((line) => line.trim().startsWith(":root"));
  const lightStart = lines.findIndex((line) =>
    line.trim().startsWith(lightRule),
  );
  return {
    dark: darkStart === -1 ? new Set() : blockFrom(lines, darkStart),
    light: lightStart === -1 ? new Set() : blockFrom(lines, lightStart),
  };
}

/**
 * Every problem in these stylesheets, as `path:line: what`. `setInCode` names
 * the custom properties components set themselves, through a style attribute.
 */
export function themeProblems(sheets, setInCode = new Set()) {
  const problems = [];
  const declared = new Set();
  const referenced = new Map();
  const themes = { dark: new Map(), light: new Map() };
  const values = { dark: new Map(), light: new Map() };
  /** The tokens numbered series' rules use: their colours are judged below. */
  const series = [];

  for (const { path, text: raw } of sheets) {
    const text = withoutComments(raw);
    const blocks = themeBlocks(text);
    for (const { name, line } of seriesTokens(text))
      series.push({ name, where: `${path}:${line}` });

    text.split("\n").forEach((line, index) => {
      const where = `${path}:${index + 1}`;
      for (const [, name] of line.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)) {
        declared.add(name);
        const hex = line.match(/:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];
        for (const theme of ["dark", "light"]) {
          if (!blocks[theme].has(index)) continue;
          themes[theme].set(name, where);
          if (hex) values[theme].set(name, hex);
        }
      }
      const size = line.match(fontDeclaration);
      const sizing = size && sizeProblem(size[1]);
      if (sizing) problems.push(`${where}: ${sizing}`);
      if (/(?<![\w-])attr\s*\(/i.test(line))
        problems.push(
          `${where}: a value read from an attribute; use the shared hover tip`,
        );
      for (const [, name] of line.matchAll(/var\((--[a-z][a-z0-9-]*)/g))
        if (!referenced.has(name)) referenced.set(name, where);

      if (blocks.dark.has(index) || blocks.light.has(index)) return;
      // A data URI writes # as %23.
      const decoded = line.replaceAll(/%23/gi, "#");
      if (literalColour.test(decoded) || namedColour.test(line))
        problems.push(`${where}: literal colour: ${line.trim()}`);
    });
  }

  // A colour is a token the themes define; a measurement beside it is not one.
  for (const { name, where } of series)
    if (
      (themes.dark.has(name) || themes.light.has(name)) &&
      ![...textTokens, ...markTokens].includes(name)
    )
      problems.push(
        `${where}: ${name} draws a numbered series, which takes a text or chart colour, held to a contrast floor`,
      );
  for (const [name, where] of referenced)
    if (!declared.has(name) && !setInCode.has(name))
      problems.push(`${where}: ${name} is used but never defined`);
  for (const [name, where] of themes.dark)
    if (!themes.light.has(name))
      problems.push(
        `${where}: ${name} is in the dark theme but not the light one`,
      );
  for (const [name, where] of themes.light)
    if (!themes.dark.has(name))
      problems.push(
        `${where}: ${name} is in the light theme but not the dark one`,
      );
  // A colour the check cannot read would leave its contrast unchecked.
  for (const theme of ["dark", "light"])
    for (const name of [...textTokens, ...markTokens, ...groundTokens])
      if (themes[theme].has(name) && !values[theme].has(name))
        problems.push(
          `${themes[theme].get(name)}: ${name} in the ${theme} theme is not a six-digit hex colour, so its contrast cannot be checked`,
        );
  for (const theme of ["dark", "light"])
    for (const text of textTokens)
      for (const ground of groundTokens) {
        const fg = values[theme].get(text);
        const bg = values[theme].get(ground);
        if (!fg || !bg) continue;
        const ratio = contrast(fg, bg);
        if (ratio < minimumContrast)
          problems.push(
            `${themes[theme].get(text)}: ${text} reads at ${ratio.toFixed(2)}:1 on ${ground} in the ${theme} theme, under ${minimumContrast}:1`,
          );
      }
  for (const theme of ["dark", "light"])
    for (const mark of markTokens)
      for (const ground of groundTokens) {
        const fg = values[theme].get(mark);
        const bg = values[theme].get(ground);
        if (!fg || !bg) continue;
        const ratio = contrast(fg, bg);
        if (ratio < minimumMarkContrast)
          problems.push(
            `${themes[theme].get(mark)}: ${mark} stands out at ${ratio.toFixed(2)}:1 on ${ground} in the ${theme} theme, under ${minimumMarkContrast}:1`,
          );
      }
  return problems;
}

async function filesEndingIn(directory, ending) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesEndingIn(path, ending)));
    else if (entry.name.endsWith(ending)) found.push(path);
  }
  return found;
}

/** Custom properties a component sets itself, as a key of a style object. */
async function propertiesSetInCode() {
  const set = new Set();
  for (const path of await filesEndingIn(styleRoot, ".tsx"))
    for (const [, name] of (await readFile(path, "utf8")).matchAll(
      /["'`](--[a-z][a-z0-9-]*)["'`]\s*:/g,
    ))
      set.add(name);
  return set;
}

export async function problemsInRenderer() {
  const sheets = [];
  for (const path of await filesEndingIn(styleRoot, ".css")) {
    if (notProductSurface.test(path)) continue;
    sheets.push({
      path: relative(repositoryRoot, path).replaceAll("\\", "/"),
      text: await readFile(path, "utf8"),
    });
  }
  return themeProblems(sheets, await propertiesSetInCode());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = await problemsInRenderer();
  if (problems.length > 0) {
    console.error("Theme check failed:\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      "\nEvery colour belongs in the theme blocks, and both themes define the" +
        "\nsame ones. A rule that paints a literal cannot follow the theme, and" +
        "\na token that is never defined paints nothing at all.",
    );
    process.exit(1);
  }
  console.log("Both themes define the same colours, and no literals outside.");
}
