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

export type FileKind =
  | { readonly kind: "text" }
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

/**
 * A file's text, cut from the middle when it is longer than a turn can carry.
 *
 * The middle is what goes because the two ends are what answer questions: the
 * top of a file says what it is, and the bottom of a log says what happened
 * last. A head-only cut throws the second away and reads, to anyone downstream,
 * exactly like a file that simply ends there.
 */
export function boundedFileText(
  text: string,
  maximum: number,
): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= maximum) return { text, truncated: false };
  const marker = (omitted: number) =>
    `\n\n… ${omitted.toLocaleString("en-US")} characters left out of the middle of this file. Read a smaller part of it if you need them. …\n\n`;
  const room = maximum - marker(text.length).length;
  const half = Math.max(0, Math.floor(room / 2));
  const head = text.slice(0, half);
  const tail = text.slice(text.length - half);
  return {
    text: `${head}${marker(text.length - head.length - tail.length)}${tail}`,
    truncated: true,
  };
}
