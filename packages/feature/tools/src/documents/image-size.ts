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
 * The sizes providers refuse vary from model to model, and which one applies
 * depends on a model chosen after this code was written; past the resolution
 * a model reads, more pixels are downscaled on arrival, paid for and never
 * looked at. 2000 sits under the smallest refusal limit the labs document and
 * near the resolution most models read; the figures, with the date they were
 * checked, are in the stack reference. The cost is some detail on a
 * high-resolution model, paid so that none refuses a picture for its size.
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
