/**
 * Keeps diagram text readable on whatever ground it lands on.
 *
 * A diagram's author picks its colours. The theme picks one text colour for
 * all of them, which is fine until an author fills a node or a subgraph with
 * something pale: near-white lettering on a pale blue panel is a label nobody
 * can read, and the app drew it that way. The author is not wrong to want the
 * colour, and the theme is not wrong about the default, so the fix belongs
 * where the two meet — after the drawing exists and both are known.
 *
 * Only failing text is repainted. A colour the author chose that already reads
 * is left alone, because overriding it would be the same mistake in the other
 * direction: deciding for them about something they got right.
 */

/** WCAG AA for body text. Below this, the label is not readable. */
const minimumContrast = 4.5;

export type Ink = { readonly light: string; readonly dark: string };

type Channel = { readonly r: number; readonly g: number; readonly b: number };

function parseColour(value: string | null | undefined): Channel | undefined {
  if (!value) return undefined;
  const text = value.trim().toLowerCase();
  if (!text || text === "none" || text === "transparent") return undefined;
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean);
    const [r, g, b, a] = parts.map(Number);
    if ([r, g, b].some((part) => part === undefined || Number.isNaN(part)))
      return undefined;
    // A nearly transparent fill is not the ground; whatever is behind it is.
    if (a !== undefined && !Number.isNaN(a) && a < 0.75) return undefined;
    return { r: r!, g: g!, b: b! };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (!hex) return undefined;
  const digits = hex[1]!;
  const wide =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return {
    r: Number.parseInt(wide.slice(0, 2), 16),
    g: Number.parseInt(wide.slice(2, 4), 16),
    b: Number.parseInt(wide.slice(4, 6), 16),
  };
}

function luminance({ r, g, b }: Channel): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(one: Channel, other: Channel): number {
  const [lighter, darker] = [luminance(one), luminance(other)].sort(
    (left, right) => right - left,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

/**
 * A fill from the element itself before the stylesheet, so this works on a
 * fragment that was never laid out as well as on a drawing on screen.
 */
function fillOf(element: Element): Channel | undefined {
  const own =
    (element as SVGElement).style?.getPropertyValue("fill") ||
    element.getAttribute("fill");
  const declared = parseColour(own);
  if (declared) return declared;
  if (own) return undefined;
  const computed =
    typeof globalThis.getComputedStyle === "function"
      ? globalThis.getComputedStyle(element)
      : undefined;
  if (computed && Number(computed.fillOpacity || "1") < 0.75) return undefined;
  return parseColour(computed?.fill);
}

const shapes =
  ":scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path";

/**
 * A shape with no area is not ground. Diagrams carry collapsed backdrop rects
 * behind their labels — filled, and zero by zero — and taking one of those for
 * the background is how a pale panel comes to look dark.
 */
function paints(shape: Element): boolean {
  const measurable = shape as SVGGraphicsElement;
  if (typeof measurable.getBBox !== "function") return true;
  try {
    const box = measurable.getBBox();
    return box.width > 0 && box.height > 0;
  } catch {
    // Not laid out, so its size is unknowable rather than zero.
    return true;
  }
}

/**
 * The ground a label sits on: the nearest enclosing shape with a solid fill.
 * A node's box wins over the subgraph panel behind it, because that is the
 * order they are painted in.
 */
function groundBehind(text: Element, root: Element): Channel | undefined {
  for (
    let ancestor = text.parentElement;
    ancestor && ancestor !== root.parentElement;
    ancestor = ancestor.parentElement
  ) {
    for (const shape of ancestor.querySelectorAll(shapes)) {
      if (!paints(shape)) continue;
      const fill = fillOf(shape);
      if (fill) return fill;
    }
  }
  return undefined;
}

export function repaintTextForContrast(
  root: Element,
  ink: Ink,
  background: string,
): void {
  const canvas = parseColour(background);
  const light = parseColour(ink.light);
  const dark = parseColour(ink.dark);
  if (!canvas || !light || !dark) return;

  for (const text of root.querySelectorAll("text")) {
    const ground = groundBehind(text, root) ?? canvas;
    const current = fillOf(text);
    if (current && contrast(current, ground) >= minimumContrast) continue;
    const better =
      contrast(light, ground) >= contrast(dark, ground) ? ink.light : ink.dark;
    // `important`, because the colour being corrected came from a stylesheet
    // inside the drawing, which would otherwise win over an attribute.
    text.style.setProperty("fill", better, "important");
    for (const span of text.querySelectorAll("tspan"))
      (span as SVGElement).style.setProperty("fill", better, "important");
  }
}
