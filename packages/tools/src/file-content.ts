/**
 * What a file's bytes turn out to be, and how much of them a turn can carry.
 *
 * Both questions are answered from the bytes rather than from the name. A path
 * is chosen by the model, and `.txt` on a JPEG is a claim, not a fact; reading
 * one as UTF-8 produces a page of replacement characters that costs real money
 * and says nothing.
 */

/** Signatures worth naming, so a refusal can say what the file actually is. */
const signatures: readonly {
  readonly bytes: readonly number[];
  readonly offset?: number;
  readonly kind: string;
  readonly mediaType?: string;
}[] = [
  {
    bytes: [0x89, 0x50, 0x4e, 0x47],
    kind: "a PNG image",
    mediaType: "image/png",
  },
  { bytes: [0xff, 0xd8, 0xff], kind: "a JPEG image", mediaType: "image/jpeg" },
  {
    bytes: [0x47, 0x49, 0x46, 0x38],
    kind: "a GIF image",
    mediaType: "image/gif",
  },
  {
    bytes: [0x57, 0x45, 0x42, 0x50],
    offset: 8,
    kind: "a WebP image",
    mediaType: "image/webp",
  },
  { bytes: [0x42, 0x4d], kind: "a bitmap image", mediaType: "image/bmp" },
  { bytes: [0x25, 0x50, 0x44, 0x46], kind: "a PDF document" },
  { bytes: [0x50, 0x4b, 0x03, 0x04], kind: "a zip archive or Office document" },
  { bytes: [0x1f, 0x8b], kind: "a gzip archive" },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], kind: "a Linux program" },
  { bytes: [0x4d, 0x5a], kind: "a Windows program" },
  { bytes: [0x49, 0x44, 0x33], kind: "an MP3 audio file" },
  { bytes: [0x00, 0x00, 0x01, 0x00], kind: "an icon file" },
];

/** How a text file's characters are written, as its bytes say. */
export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be";

export type FileKind =
  | {
      readonly kind: "text";
      /** Named only when it is not UTF-8, by a byte-order mark. */
      readonly encoding?: TextEncoding;
    }
  | {
      readonly kind: "binary";
      /** What it is, in words, when the bytes say so. */
      readonly named?: string;
      /** Set when this is an image the picture tools can open. */
      readonly mediaType?: string;
    };

function matches(bytes: Buffer, signature: (typeof signatures)[number]) {
  const offset = signature.offset ?? 0;
  return signature.bytes.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Whether these bytes are text.
 *
 * A NUL byte settles it: no UTF-8 text file contains one. Beyond that the test
 * is proportional — a scattering of control bytes is a file that is not text,
 * while tabs, newlines and any amount of accented or non-Latin script are
 * ordinary text and must never be refused as binary.
 */
export function fileKind(sample: Buffer): FileKind {
  // UTF-16 holds a zero byte in every ASCII character, so it is judged by the
  // characters its mark says it holds, not by its bytes.
  const encoding = utf16Mark(sample);
  if (encoding) {
    const characters = new TextDecoder(encoding).decode(sample);
    return plainCharacters(characters)
      ? { kind: "text", encoding }
      : { kind: "binary" };
  }
  const known = signatures.find((signature) => matches(sample, signature));
  if (known)
    return {
      kind: "binary",
      named: known.kind,
      ...(known.mediaType ? { mediaType: known.mediaType } : {}),
    };
  if (!sample.length) return { kind: "text" };
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return { kind: "binary" };
    // C0 controls other than tab, newline, carriage return and form feed.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
  }
  return suspicious / sample.length > 0.1
    ? { kind: "binary" }
    : { kind: "text" };
}

function utf16Mark(sample: Buffer): TextEncoding | undefined {
  if (sample[0] === 0xff && sample[1] === 0xfe) return "utf-16le";
  if (sample[0] === 0xfe && sample[1] === 0xff) return "utf-16be";
  return undefined;
}

/** Characters a text holds, few of them control characters other than layout. */
function plainCharacters(text: string): boolean {
  if (!text.length) return true;
  let suspicious = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0) return false;
    if (code < 0x09 || (code > 0x0d && code < 0x20)) suspicious += 1;
  }
  return suspicious / text.length <= 0.1;
}

/**
 * The first line, counted from 1, holding bytes that are not UTF-8, or
 * nothing when every byte is.
 */
export async function firstLineNotUtf8(
  bytes: AsyncIterable<Uint8Array>,
): Promise<number | undefined> {
  let line = 1;
  // Continuation bytes still owed by the character under way, and the range
  // the next one must fall in, which the first byte narrows.
  let owed = 0;
  let lowest = 0x80;
  let highest = 0xbf;
  for await (const chunk of bytes)
    for (const byte of chunk) {
      if (owed) {
        if (byte < lowest || byte > highest) return line;
        lowest = 0x80;
        highest = 0xbf;
        owed -= 1;
        continue;
      }
      if (byte === 0x0a) line += 1;
      if (byte < 0x80) continue;
      if (byte >= 0xc2 && byte <= 0xdf) owed = 1;
      else if (byte === 0xe0) [owed, lowest] = [2, 0xa0];
      else if (byte === 0xed) [owed, highest] = [2, 0x9f];
      else if (byte >= 0xe1 && byte <= 0xef) owed = 2;
      else if (byte === 0xf0) [owed, lowest] = [3, 0x90];
      else if (byte === 0xf4) [owed, highest] = [3, 0x8f];
      else if (byte >= 0xf1 && byte <= 0xf3) owed = 3;
      else return line;
    }
  return owed ? line : undefined;
}
