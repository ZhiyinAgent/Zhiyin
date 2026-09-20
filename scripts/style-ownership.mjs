/**
 * Each renderer module owns its styles and names no other module's (ADR 0035).
 *
 * A module's styles are a CSS Module, so its class names are private to it in
 * the built app. What that cannot stop is a rule written somewhere else: a
 * class defined in the global stylesheet, a module sheet reaching out through
 * a global selector, a rule that styles elements the module does not own, one
 * stylesheet pulling in another, or a component writing a class name as plain
 * text that nothing of its own defines. ESLint reads neither stylesheets nor
 * the strings inside a `className`, so these checks stand where a lint rule
 * would.
 *
 * Stylesheets are parsed rather than matched, because a comment, a string or a
 * media query is not a selector and a check that cannot tell the difference
 * reports the wrong thing - or nothing.
 */

import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const renderer = join(repositoryRoot, "apps/desktop/src/renderer");

/**
 * The basics any module may use. Everything else belongs to one module, so
 * adding a name here is meant to be a deliberate step.
 */
export const SHARED_BASICS = new Set([
  "button",
  "button--accent",
  "button--quiet",
  "button--small",
  "text-button",
  "eyebrow",
  "instrument-label",
]);

/**
 * The component lab and demo stage are pages drawn around the app for review;
 * their own frames are not product styles.
 */
const notProductSurface = /[\\/]demo[\\/]/;

const classInSelector = /\.(-?[A-Za-z_][\w-]*)/g;
const classInText = /-?[A-Za-z_][\w-]*/g;

const classesIn = (text) =>
  [...text.matchAll(classInSelector)].map(([, name]) => name);

/**
 * A selector split into what it reaches outside the module and what it keeps
 * inside it. `:global(.x)` names one thing; a bare `:global` hands everything
 * after it to the page.
 */
function scopesOf(selector) {
  const outside = [];
  let inside = selector.replace(/:global\(([^()]*)\)/g, (_match, named) => {
    outside.push(named);
    return " ";
  });
  const bare = inside.match(/:global\b(?!\()/);
  if (bare) {
    outside.push(inside.slice(bare.index + bare[0].length));
    inside = inside.slice(0, bare.index);
  }
  return { outside: outside.join(" "), inside };
}

/** Rules inside `@keyframes` name a moment, not an element. */
const isAnimationStep = (rule) =>
  rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name);

export function stylesheetProblems(path, text) {
  const isModule = path.endsWith(".module.css");
  let root;
  try {
    root = postcss.parse(text, { from: path });
  } catch (error) {
    return [`${path}: could not be read as CSS (${error.message})`];
  }
  const problems = new Set();

  root.walkAtRules("import", (rule) => {
    if (isModule || /\.module\.css/.test(rule.params))
      problems.add(
        `${path}: pulls in ${rule.params}; a module's styles stand alone`,
      );
  });

  root.walkDecls("composes", (declaration) => {
    const source = declaration.value.match(/from\s+("[^"]*"|'[^']*')/);
    if (source)
      problems.add(
        `${path}: composes from ${source[1]}; use that module's component rather than its classes`,
      );
  });

  root.walkRules((rule) => {
    if (isAnimationStep(rule)) return;
    for (const selector of rule.selectors) {
      const { outside, inside } = scopesOf(selector);
      for (const name of classesIn(outside))
        if (!SHARED_BASICS.has(name))
          problems.add(
            `${path}: ".${name}" belongs to another stylesheet; a module names only its own classes and the shared basics`,
          );
      if (!isModule) {
        for (const name of classesIn(inside))
          if (!SHARED_BASICS.has(name))
            problems.add(
              `${path}: ".${name}" is not a shared basic; it belongs in the CSS Module of the module that draws it`,
            );
        continue;
      }
      // Inside a module, a rule that names none of its own classes is a rule
      // about the page. What sits inside its own element is its own business.
      if (!classesIn(inside).length)
        problems.add(
          `${path}: "${selector}" styles elements this module does not own; every rule of its own names one of its own classes`,
        );
    }
  });

  return [...problems];
}

/** A literal compared against, `kind === "open"`, names a state, not a class. */
function isComparedAgainst(node) {
  const parent = node.parent;
  if (ts.isCaseClause(parent)) return true;
  return (
    ts.isBinaryExpression(parent) &&
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
    ].includes(parent.operatorToken.kind)
  );
}

export function componentProblems(path, source) {
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const written = new Set();
  const literalsIn = (node) => {
    // `styles["name"]` looks a class up; its key is not written as a class.
    if (ts.isElementAccessExpression(node)) {
      literalsIn(node.expression);
      return;
    }
    const texts = [];
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isComparedAgainst(node)) texts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      texts.push(
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      );
    }
    for (const text of texts)
      for (const [name] of text.matchAll(classInText))
        if (!SHARED_BASICS.has(name)) written.add(name);
    ts.forEachChild(node, literalsIn);
  };
  const visit = (node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(tree) === "className" &&
      node.initializer
    )
      literalsIn(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return [...written].map(
    (name) =>
      `${path}: "${name}" is written as a plain class name; look it up on the module's styles, or use a shared basic`,
  );
}

async function filesUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else found.push(path);
  }
  return found;
}

export async function problemsInRenderer() {
  const problems = [];
  for (const path of await filesUnder(renderer)) {
    if (notProductSurface.test(path)) continue;
    const shown = relative(repositoryRoot, path).replaceAll("\\", "/");
    if (path.endsWith(".module.css")) {
      const expected = `${basename(dirname(path))}.module.css`;
      if (basename(path) !== expected)
        problems.push(
          `${shown}: a module stylesheet is named for its owning module; expected ${expected}`,
        );
    }
    if (path.endsWith(".css"))
      problems.push(...stylesheetProblems(shown, await readFile(path, "utf8")));
    else if (path.endsWith(".tsx") && !path.endsWith(".test.tsx"))
      problems.push(...componentProblems(shown, await readFile(path, "utf8")));
  }
  return problems.sort();
}
