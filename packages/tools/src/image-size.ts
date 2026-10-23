/**
 * How large a picture is, read from its header rather than by decoding it.
 *
 * Only the header is read. Decoding a 40-megapixel image to learn its width
 * costs a hundred megabytes of memory to answer a question the first few bytes
 * already answer.
 */

export type ImageSize = { readonly width: number; readonly height: number };

/**
 * The largest a picture is worth sending on its longest side.
 *
 * This is deliberately not the size at which a provider would refuse one.
 * Those thresholds vary too widely to guide the choice: they range from 2048
 * pixels (OpenAI gpt-5.4) through 6000 (gpt-5.5, and Z.AI's GLM series) to
 * 65535 (OpenAI's newest) and 8000 (Claude), and which one applies depends on
 * a model chosen after this code was written.
 *
 * What every provider agrees on is the resolution its model actually reads.
 * Claude downscales to a 1568-pixel long edge, or 2576 on its high-resolution
 * tier; OpenAI fits a high-detail image inside 2048 by 2048. Above those, more
 * pixels are discarded on arrival — paid for, and never looked at.
 *
 * 2000 sits under the smallest refusal threshold anyone documents, at or above
 * the resolution most models read, and is the size Anthropic itself asks for
 * when a request carries many images — which a turn that keeps looking at a
 * page does. The cost is some detail on Claude's high-resolution tier, paid so
 * that none of those models refuses a picture for its size.
 */
export const maximumImagePixels = 2000;

/** Start-of-frame markers: the ones that carry a JPEG's dimensions. */
const jpegFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function png(bytes: Buffer): ImageSize | undefined {
  // Signature, then the IHDR chunk, whose first two fields are the dimensions.
  if (bytes.length < 24 || bytes.toString("latin1", 12, 16) !== "IHDR")
    return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpeg(bytes: Buffer): ImageSize | undefined {
  // Segment by segment from after the start marker. Metadata segments — an
  // EXIF block, a colour profile — can be large, so the frame is looked for
  // rather than assumed to be at a fixed place.
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (jpegFrameMarkers.has(marker))
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function gif(bytes: Buffer): ImageSize | undefined {
  if (bytes.length < 10) return undefined;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function bmp(bytes: Buffer): ImageSize | undefined {
  if (bytes.length < 26) return undefined;
  return {
    width: Math.abs(bytes.readInt32LE(18)),
    // Negative means the rows are stored top-down; it is still a height.
    height: Math.abs(bytes.readInt32LE(22)),
  };
}

/** WebP keeps its size in whichever of three chunk kinds the file uses. */
function webp(bytes: Buffer): ImageSize | undefined {
  if (bytes.length < 30) return undefined;
  const chunk = bytes.toString("latin1", 12, 16);
  if (chunk === "VP8 ")
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  if (chunk === "VP8L") {
    // Fourteen bits each, packed across four bytes after the signature byte.
    const packed = bytes.readUInt32LE(21);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X")
    return {
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    };
  return undefined;
}

/**
 * The size of the picture these bytes begin, or nothing when they are not a
 * picture this can measure. Nothing is never a claim that the picture is small.
 */
export function imageSize(bytes: Buffer): ImageSize | undefined {
  const found = bytes.subarray(0, 4).toString("hex").startsWith("89504e47")
    ? png(bytes)
    : bytes[0] === 0xff && bytes[1] === 0xd8
      ? jpeg(bytes)
      : bytes.toString("latin1", 0, 3) === "GIF"
        ? gif(bytes)
        : bytes.toString("latin1", 0, 2) === "BM"
          ? bmp(bytes)
          : bytes.toString("latin1", 0, 4) === "RIFF" &&
              bytes.toString("latin1", 8, 12) === "WEBP"
            ? webp(bytes)
            : undefined;
  return found && found.width > 0 && found.height > 0 ? found : undefined;
}
