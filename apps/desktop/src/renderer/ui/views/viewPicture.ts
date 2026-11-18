/**
 * A drawn view as a picture, for a model that looks at what it drew: the same
 * file the person's Save writes, on the ground the window shows it on, turned
 * into a PNG by the browser that drew it.
 */

import type { ProducedImage } from "@zhiyin/contract";
import { standalone } from "./standaloneSvg.js";

/** The longest side of the picture, in pixels: readable, not a poster. */
const longestSide = 1600;
/** How long the browser may take to read the drawing as an image. */
const decodeMs = 3_000;

export async function pictureOf(
  drawing: SVGSVGElement,
  ground: string,
): Promise<ProducedImage | undefined> {
  const [, , width = 0, height = 0] = (drawing.getAttribute("viewBox") ?? "")
    .split(/\s+/)
    .map(Number);
  if (!(width > 0 && height > 0)) return undefined;
  const canvas = document.createElement("canvas");
  // Twice the drawn size where that fits, so small text stays legible.
  const scale = Math.min(2, longestSide / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  let context: CanvasRenderingContext2D | null;
  try {
    context = canvas.getContext("2d");
  } catch {
    return undefined;
  }
  if (!context) return undefined;
  // An image takes its size from the file, which a drawing that fits its
  // card leaves to the card.
  const file = new DOMParser().parseFromString(
    standalone(drawing),
    "image/svg+xml",
  ).documentElement;
  file.setAttribute("width", String(width));
  file.setAttribute("height", String(height));
  for (const property of ["width", "height", "max-width"])
    (file as unknown as SVGElement).style?.removeProperty(property);
  const sized = new XMLSerializer().serializeToString(file);
  const image = new Image();
  const loaded = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), decodeMs);
    image.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
  if (!(await loaded)) return undefined;
  context.fillStyle = ground;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/png");
  const data = url.slice(url.indexOf(",") + 1);
  return url.startsWith("data:image/png;base64,") && data
    ? { mediaType: "image/png", data }
    : undefined;
}
