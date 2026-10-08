/**
 * An SVG given a size the drawing process can afford before it is decoded.
 *
 * The canvas rasterises an SVG as it decodes it, at the size the file
 * declares: one that declares itself 100,000 pixels square ends the process
 * that decodes it (@napi-rs/canvas 1.0.8). So the size is read from the root
 * element first and written back no larger than the bound.
 */

const pixelsPer: Readonly<Record<string, number>> = {
  "": 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};

/**
 * The root element, after the declaration and comments `kindOf` allows. A
 * comment's body is anything but its end, so a run of comments can be read
 * only one way; a lazy body could also swallow "--><!--", which would double
 * the work with each comment when no root follows.
 */
const rootElement =
  /^(\s*(?:<\?xml[^>]*>\s*)?(?:<!--(?:[^-]|-(?!->))*-->\s*)*)(<svg\b[^>]*>)/i;

function attribute(tag: string, name: string): string | undefined {
  const found = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  ).exec(tag);
  return found ? (found[1] ?? found[2]) : undefined;
}

/** An absolute length in CSS pixels; a percentage or a font size is none. */
function length(value: string | undefined): number | undefined {
  const found = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(px|pt|pc|in|cm|mm)?\s*$/i.exec(
    value ?? "",
  );
  if (!found) return undefined;
  const pixels = Number(found[1]) * pixelsPer[(found[2] ?? "").toLowerCase()]!;
  return pixels > 0 && Number.isFinite(pixels) ? pixels : undefined;
}

/**
 * The SVG with its root sized to fit `longestSide`, keeping its proportions,
 * or nothing when it says no size: no absolute width and height, and no
 * viewBox to take them, or the missing one, from.
 */
export function fittedSvg(
  bytes: Uint8Array,
  longestSide: number,
): Buffer | undefined {
  const text = Buffer.from(bytes).toString("utf8");
  const root = rootElement.exec(text);
  if (!root) return undefined;
  const [whole, before, tag] = root as unknown as [string, string, string];
  const box = attribute(tag, "viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const boxSize =
    box?.length === 4 &&
    box.every(Number.isFinite) &&
    box[2]! > 0 &&
    box[3]! > 0
      ? { width: box[2]!, height: box[3]! }
      : undefined;
  let width = length(attribute(tag, "width"));
  let height = length(attribute(tag, "height"));
  if (boxSize && width === undefined && height === undefined) {
    width = boxSize.width;
    height = boxSize.height;
  } else if (boxSize && width === undefined && height !== undefined)
    width = (height * boxSize.width) / boxSize.height;
  else if (boxSize && height === undefined && width !== undefined)
    height = (width * boxSize.height) / boxSize.width;
  if (width === undefined || height === undefined) return undefined;

  const scale = Math.min(1, longestSide / Math.max(width, height));
  const sized = tag
    .replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(
      /^<svg\b/i,
      `<svg width="${Math.max(1, Math.round(width * scale))}" height="${Math.max(1, Math.round(height * scale))}"${
        // Without a viewBox a user unit is a pixel; one keeps the drawing
        // whole when the size it is given shrinks.
        boxSize ? "" : ` viewBox="0 0 ${width} ${height}"`
      }`,
    );
  return Buffer.from(before + sized + text.slice(whole.length), "utf8");
}
