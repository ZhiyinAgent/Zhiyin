/**
 * A drawing as a file of its own: what the window's stylesheet painted is
 * written onto each element, so the drawing looks the same outside the app,
 * where the person saves it and where it is turned into a picture.
 */

/**
 * A saved view leaves the app that styled it. What the stylesheet was painting
 * has to travel with the file, or the person opens an image that is missing the
 * lines and text they were looking at when they asked to save it.
 */
const painted = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "font",
  "opacity",
] as const;

/** Of those, the ones a child takes from its parent unless told otherwise. */
const inherited = new Set<string>([
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "font",
]);

/**
 * The attributes a painted value is also written as. Renderers that read no
 * stylesheet and drop an important declaration, as Skia does in the document
 * view, draw from these; a browser lets any style outrank them. The
 * font is written as its parts, which every renderer reads.
 */
const attributesOf: Record<(typeof painted)[number], readonly string[]> = {
  fill: ["fill"],
  stroke: ["stroke"],
  "stroke-width": ["stroke-width"],
  "stroke-dasharray": ["stroke-dasharray"],
  font: ["font-family", "font-size", "font-weight", "font-style"],
  opacity: ["opacity"],
};

/** Elements that paint nothing: a point's tooltip, a drawing's stylesheet. */
const unpainted = new Set(["title", "desc", "metadata", "style"]);

/**
 * Whether the element sets this property itself, by an attribute or its own
 * style, which would outrank what it inherits in the saved file.
 */
function setsItself(element: Element, property: string): boolean {
  const own = (name: string) =>
    name === property || (property === "font" && name.startsWith("font"));
  return (
    [...element.attributes].some((attribute) => own(attribute.name)) ||
    (element.getAttribute("style") ?? "")
      .split(";")
      .some((declaration) => own(declaration.split(":")[0]!.trim()))
  );
}

export function standalone(drawn: SVGElement): string {
  const copy = drawn.cloneNode(true) as SVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // A drawing with no stylesheet of its own lets each element inherit in the
  // file as it did in the window, so a value it shares with its parent is
  // left out: a chart of thousands of points stays small enough to save.
  const ownRules = drawn.querySelector("style") !== null;
  const originals = [drawn, ...drawn.querySelectorAll("*")];
  [copy, ...copy.querySelectorAll("*")].forEach((element, index) => {
    const source = originals[index];
    if (!source || unpainted.has(source.localName)) return;
    const computed = getComputedStyle(source);
    const parent =
      index > 0 && source.parentElement
        ? getComputedStyle(source.parentElement)
        : undefined;
    // Important, so that what was painted outranks the drawing's own rules,
    // which Mermaid writes as important, as it did in the window.
    for (const property of painted) {
      const value = computed.getPropertyValue(property);
      if (!value) continue;
      const unchanged = inherited.has(property)
        ? parent?.getPropertyValue(property) === value
        : value === "1";
      if (!ownRules && unchanged && !setsItself(source, property)) continue;
      (element as SVGElement).style.setProperty(property, value, "important");
      for (const attribute of attributesOf[property]) {
        const part =
          property === "font" ? computed.getPropertyValue(attribute) : value;
        if (part && !source.hasAttribute(attribute))
          element.setAttribute(attribute, part);
      }
    }
  });
  return copy.outerHTML;
}
