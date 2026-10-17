/**
 * Whether a streamed frame was drawn at the scale it says. Chromium can send,
 * while the page is being resized, a frame already labelled with the new size
 * whose picture was still drawn to fit the old one; shown, it is blurred.
 */

/** A JPEG's width and height, read from its frame header. */
function pictureSize(
  base64: string,
): { readonly width: number; readonly height: number } | undefined {
  // The frame header comes within the first segments; no need to decode all.
  const bytes = Buffer.from(base64.slice(0, 8_192), "base64");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xc3)
      return {
        height: bytes.readUInt16BE(at + 5),
        width: bytes.readUInt16BE(at + 7),
      };
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return undefined;
}

/**
 * Whether a frame's picture is its page size times the screen's density,
 * within a pixel of rounding.
 */
export function drawnAtScale(
  data: string,
  page: { readonly width: number; readonly height: number },
  density: number,
): boolean {
  const picture = pictureSize(data);
  return (
    picture !== undefined &&
    Math.abs(picture.width - page.width * density) <= 1 &&
    Math.abs(picture.height - page.height * density) <= 1
  );
}
