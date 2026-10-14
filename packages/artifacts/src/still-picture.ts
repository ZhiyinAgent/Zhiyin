/**
 * Whether a drawing is safe to save as a file a person may later open in a
 * browser: made only of what a still picture is made of, and reaching nothing
 * outside itself.
 *
 * An allowlist, so what it does not know is refused. The elements are those
 * the app's charts and every Mermaid diagram type draw, measured, and a few
 * more of the same still kind: no script, no animation, no HTML, no picture
 * from a file. Every link and every `url(...)` points inside the drawing, and
 * a stylesheet imports nothing. Character references are read as a browser
 * reads them before anything is checked, and a style that hides itself in CSS
 * escapes is refused.
 */

const elements = new Set(
  [
    "svg",
    "g",
    "defs",
    "symbol",
    "use",
    "switch",
    "title",
    "desc",
    "style",
    "marker",
    "clipPath",
    "mask",
    "pattern",
    "linearGradient",
    "radialGradient",
    "stop",
    "filter",
    "feDropShadow",
    "feGaussianBlur",
    "feOffset",
    "feFlood",
    "feComposite",
    "feMerge",
    "feMergeNode",
    "feBlend",
    "feColorMatrix",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
  ].map((name) => name.toLowerCase()),
);

const named: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Text as a browser reads it, character references resolved. */
function decoded(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi,
    (whole, reference: string) => {
      if (reference[0] !== "#") return named[reference.toLowerCase()] ?? whole;
      const code =
        reference[1] === "x" || reference[1] === "X"
          ? Number.parseInt(reference.slice(2), 16)
          : Number.parseInt(reference.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    },
  );
}

/** Every `url(...)` points inside the drawing, and nothing names script. */
function reachesNothingOutside(value: string): boolean {
  const lower = value.toLowerCase();
  if (/javascript:|expression\(/.test(lower)) return false;
  for (const match of lower.matchAll(/url\(\s*(["']?)\s*(.)/g))
    if (match[2] !== "#") return false;
  return true;
}

function safeStyle(css: string): boolean {
  return (
    !css.includes("\\") && !/@import/i.test(css) && reachesNothingOutside(css)
  );
}

function safeAttribute(name: string, raw: string): boolean {
  const lower = name.toLowerCase();
  const value = decoded(raw);
  if (lower.startsWith("on")) return false;
  if (lower === "href" || lower.endsWith(":href"))
    return value.trimStart().startsWith("#");
  if (lower === "style") return safeStyle(value);
  return reachesNothingOutside(value);
}

const tagName = /[A-Za-z][\w:.-]*/y;
const attribute =
  /\s+([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
const tagEnd = /\s*\/?>/y;

export function isStillPicture(svg: string): boolean {
  let at = svg.search(/\S/);
  if (at < 0 || !/^<svg[\s>/]/i.test(svg.slice(at))) return false;
  while (at < svg.length) {
    const open = svg.indexOf("<", at);
    if (open < 0) return true;
    const next = svg[open + 1];
    // Comments, document types, entity declarations, character data and
    // processing instructions: none belong in a saved drawing.
    if (next === "!" || next === "?") return false;
    if (next === "/") {
      tagName.lastIndex = open + 2;
      const closing = tagName.exec(svg);
      if (!closing) return false;
      tagEnd.lastIndex = tagName.lastIndex;
      if (!tagEnd.exec(svg)) return false;
      at = tagEnd.lastIndex;
      continue;
    }
    tagName.lastIndex = open + 1;
    const opening = tagName.exec(svg);
    if (!opening || !elements.has(opening[0].toLowerCase())) return false;
    let cursor = tagName.lastIndex;
    for (;;) {
      attribute.lastIndex = cursor;
      const found = attribute.exec(svg);
      if (!found) break;
      const [, name, double, single, bare] = found;
      if (!safeAttribute(name as string, double ?? single ?? bare ?? ""))
        return false;
      cursor = attribute.lastIndex;
    }
    tagEnd.lastIndex = cursor;
    const ended = tagEnd.exec(svg);
    if (!ended) return false;
    at = tagEnd.lastIndex;
    // A stylesheet's text is read whole, up to its own end.
    if (opening[0].toLowerCase() === "style" && !ended[0].includes("/")) {
      const close = svg.toLowerCase().indexOf("</style", at);
      if (close < 0 || !safeStyle(decoded(svg.slice(at, close)))) return false;
      at = close;
    }
  }
  return true;
}
