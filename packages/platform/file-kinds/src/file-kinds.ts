/**
 * What a file is, by its bytes.
 *
 * A path is chosen by whoever wrote it, so `.txt` on a JPEG, or `.pdf` on a
 * note, is a claim, not a fact. The head of the file decides. The agent's
 * file tools and the document panel ask this one question here, so what the
 * agent is told a file is and what the person is shown never disagree.
 */

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
      /** Set when this is a picture: its media type. */
      readonly mediaType?: string;
    };

/** The name a PDF is given, for those that open one. */
export const pdfDocument = "a PDF document";

/** As much of the head as is looked at. */
const sampleBytes = 4096;
/** How far into the head a PDF's header may start, as PDF readers accept. */
const pdfHeaderReach = 1024;

const startsWith = (bytes: Uint8Array, offset: number, text: string) =>
  [...text].every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0),
  );

const zero = (bytes: Uint8Array, from: number, to: number) =>
  bytes.length >= to && bytes.subarray(from, to).every((byte) => byte === 0);

/**
 * The signatures worth naming. Those made of a few printable letters also
 * need what a real file of that kind has after them, or bytes that are not
 * text, so text that happens to begin with "BMW", "MZ-1200" or "GIF89a"
 * stays text.
 */
const signatures: readonly {
  readonly named: string;
  readonly mediaType?: string;
  readonly is: (bytes: Uint8Array) => boolean;
}[] = [
  {
    named: "a PNG image",
    mediaType: "image/png",
    is: (bytes) => startsWith(bytes, 0, "\x89PNG"),
  },
  {
    named: "a JPEG image",
    mediaType: "image/jpeg",
    is: (bytes) => startsWith(bytes, 0, "\xff\xd8\xff"),
  },
  {
    named: "a GIF image",
    mediaType: "image/gif",
    is: (bytes) =>
      (startsWith(bytes, 0, "GIF87a") || startsWith(bytes, 0, "GIF89a")) &&
      !plainBytes(bytes),
  },
  {
    named: "a WebP image",
    mediaType: "image/webp",
    is: (bytes) =>
      startsWith(bytes, 0, "RIFF") &&
      startsWith(bytes, 8, "WEBP") &&
      !plainBytes(bytes),
  },
  // A bitmap's bytes 6 to 9 are reserved, and zero.
  {
    named: "a bitmap image",
    mediaType: "image/bmp",
    is: (bytes) => startsWith(bytes, 0, "BM") && zero(bytes, 6, 10),
  },
  {
    named: "a zip archive or Office document",
    is: (bytes) => startsWith(bytes, 0, "PK\x03\x04"),
  },
  { named: "a gzip archive", is: (bytes) => startsWith(bytes, 0, "\x1f\x8b") },
  { named: "a Linux program", is: (bytes) => startsWith(bytes, 0, "\x7fELF") },
  // A Windows program's DOS header is mostly zero bytes.
  {
    named: "a Windows program",
    is: (bytes) =>
      startsWith(bytes, 0, "MZ") && bytes.subarray(0, 64).includes(0),
  },
  // An ID3 tag names its version, 2 to 4, then a zero revision.
  {
    named: "an MP3 audio file",
    is: (bytes) =>
      startsWith(bytes, 0, "ID3") &&
      bytes[3] !== undefined &&
      bytes[3] >= 2 &&
      bytes[3] <= 4 &&
      bytes[4] === 0,
  },
  {
    named: "an icon file",
    is: (bytes) => startsWith(bytes, 0, "\x00\x00\x01\x00"),
  },
];

/**
 * Whether these bytes are text.
 *
 * A NUL byte settles it: no UTF-8 text file contains one. Beyond that the test
 * is proportional — a scattering of control bytes is a file that is not text,
 * while tabs, newlines and any amount of accented or non-Latin script are
 * ordinary text and must never be refused as binary.
 */
export function fileKind(head: Uint8Array): FileKind {
  const sample = head.subarray(0, sampleBytes);
  // UTF-16 holds a zero byte in every ASCII character, so it is judged by the
  // characters its mark says it holds, not by its bytes.
  const encoding = utf16Mark(sample);
  if (encoding) {
    const characters = new TextDecoder(encoding).decode(sample);
    return plainCharacters(characters)
      ? { kind: "text", encoding }
      : { kind: "binary" };
  }
  const known = signatures.find((signature) => signature.is(sample));
  if (known)
    return {
      kind: "binary",
      named: known.named,
      ...(known.mediaType ? { mediaType: known.mediaType } : {}),
    };
  const text = plainBytes(sample);
  if (isPdf(sample, text)) return { kind: "binary", named: pdfDocument };
  return text ? { kind: "text" } : { kind: "binary" };
}

/**
 * A PDF: its header first, or within the first kilobyte after nothing but
 * blank space and a byte-order mark, or after bytes that are not text, as
 * readers accept. Text that mentions the header after other words is text.
 */
function isPdf(sample: Uint8Array, text: boolean): boolean {
  const head = Buffer.from(sample.subarray(0, pdfHeaderReach)).toString(
    "latin1",
  );
  const at = head.indexOf("%PDF-");
  if (at < 0) return false;
  return !text || /^(?:\xef\xbb\xbf)?\s*$/.test(head.slice(0, at));
}

function plainBytes(sample: Uint8Array): boolean {
  if (!sample.length) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    // C0 controls other than tab, newline, carriage return and form feed.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
  }
  return suspicious / sample.length <= 0.1;
}

function utf16Mark(sample: Uint8Array): TextEncoding | undefined {
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
