/**
 * A text file read a page at a time, each line numbered, so any part of it can
 * be asked for by line and nothing is silently left out of the middle.
 *
 * A page is bounded twice, by lines and by estimated tokens, so it costs about
 * the same in every language: 60,000 characters of Chinese is four times the
 * tokens of the same length of English. A line is shown whole when it fits,
 * and in parts, a page each, when it does not. The file is streamed, and a
 * line holds no more of itself than a page shows, so the file's size decides
 * how long a read takes, never how much memory it holds.
 */

import { createReadStream } from "node:fs";
import { estimatedTokens } from "@zhiyin/contract";
import { ansiCodePage, ansiText } from "@zhiyin/process-ownership";

/** The most lines one read returns when the model does not say. */
export const pageLines = 2_000;
/** The most one read returns, about what the references return. */
export const pageTokens = 8_000;
/** Kept for the note saying where the next page starts, and any notice. */
const reservedTokens = 120;

export type Page = {
  /** The numbered lines, then where the rest continues when it does. */
  readonly text: string;
  /** The same lines without numbers, as a person reads them. */
  readonly plain: string;
  readonly first: number;
  readonly last: number;
  readonly totalLines: number;
  /** The lines shown whole, when any were. */
  readonly whole?: { readonly first: number; readonly last: number };
  /**
   * The characters shown of a line shown in part, counted from 1, and how
   * many it holds; for a line too long to be held, how many of it were.
   */
  readonly part?: {
    readonly line: number;
    readonly first: number;
    readonly last: number;
    readonly characters?: number;
    readonly held?: number;
  };
};

/**
 * How a page's bytes are turned into characters. `by-line` reads each line
 * as UTF-8 where it is UTF-8, and in Windows' own code page where it is not.
 */
export type PageEncoding = "utf-8" | "utf-16le" | "utf-16be" | "by-line";

/** The answer has no room left for any of the page. */
export class NoRoomError extends Error {
  constructor() {
    super("No room is left in the answer for a page.");
    this.name = "NoRoomError";
  }
}

/** Bytes a page read as UTF-8 that are not UTF-8. */
export class NotUtf8Error extends Error {
  constructor() {
    super("The file is not UTF-8 text.");
    this.name = "NotUtf8Error";
  }
}

/**
 * The file's characters, decoded as it goes. UTF-8 is decoded strictly, so
 * bytes that are not UTF-8 are never shown as characters the file does not
 * hold; a byte-order mark is not a character of the text.
 */
async function* characters(
  path: string,
  encoding: PageEncoding,
  signal: AbortSignal | undefined,
): AsyncGenerator<string | typeof lineCutShort> {
  if (encoding === "by-line") {
    yield* lineByLine(path, signal);
    return;
  }
  const decoder = new TextDecoder(encoding, { fatal: encoding === "utf-8" });
  const decode = (chunk?: Uint8Array) => {
    try {
      return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
    } catch {
      throw new NotUtf8Error();
    }
  };
  for await (const chunk of createReadStream(path, signal ? { signal } : {}))
    yield decode(chunk as Buffer);
  yield decode();
}

/** The code page Windows reads text that names none in, unless it is UTF-8. */
function legacyCodePage(): number | undefined {
  const page = ansiCodePage();
  return page === 65001 ? undefined : page;
}

/**
 * How a line that is not UTF-8 is read: in Windows' own code page, or as
 * Windows-1252 on a PC whose own is UTF-8, which would show no character of
 * such a line.
 */
export function legacyEncodingName(): string {
  const page = legacyCodePage();
  return page === undefined
    ? "as Windows-1252"
    : `in this PC's own code page (code page ${page})`;
}

/** One line's bytes, as UTF-8 when they are, and otherwise as Windows reads them. */
export function lineText(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return (
      (legacyCodePage() === undefined ? undefined : ansiText(bytes)) ??
      new TextDecoder("windows-1252").decode(bytes)
    );
  }
}

/** Where the first line of these bytes ends, at a line feed or a carriage return. */
function lineEnd(bytes: Buffer): number {
  const feed = bytes.indexOf(0x0a);
  const back = bytes.indexOf(0x0d);
  return feed < 0 ? back : back < 0 ? feed : Math.min(feed, back);
}

/**
 * The longest part of a line that is not UTF-8 held to be decoded: such a
 * line is decoded whole, in the PC's own code page, so a longer one is read up
 * to here.
 */
const heldLineBytes = 1024 * 1024;

/** A line that is not UTF-8 went on past what was held of it. */
const lineCutShort = Symbol("line cut short");

/** The longest whole characters at the start of these UTF-8 bytes. */
function wholeCharacters(bytes: Buffer): Buffer {
  for (let back = 1; back <= Math.min(4, bytes.length); back += 1) {
    const byte = bytes[bytes.length - back] ?? 0;
    if (byte < 0x80) return bytes;
    if (byte >= 0xc0) {
      const needs = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
      return needs > back ? bytes.subarray(0, bytes.length - back) : bytes;
    }
  }
  return bytes;
}

/**
 * The file's characters a line at a time. A line ends at a line feed or a
 * carriage return, bytes that mean the same in UTF-8 and in each of Windows'
 * code pages, so a line can be decoded alone. At most `heldLineBytes` of a
 * line are held; past them it is marked as cut short.
 */
async function* lineByLine(
  path: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<string | typeof lineCutShort> {
  let held: Buffer[] = [];
  let heldBytes = 0;
  let cut = false;
  const hold = (bytes: Buffer) => {
    const room = heldLineBytes - heldBytes;
    if (bytes.length > room) cut = true;
    const kept = bytes.subarray(0, Math.max(0, room));
    if (kept.length) held.push(kept);
    heldBytes += kept.length;
  };
  function* release(ending: Buffer) {
    const bytes = Buffer.concat(held);
    yield lineText(cut ? wholeCharacters(bytes) : bytes);
    if (cut) yield lineCutShort;
    if (ending.length) yield ending.toString("latin1");
    held = [];
    heldBytes = 0;
    cut = false;
  }
  for await (const read of createReadStream(path, signal ? { signal } : {})) {
    let chunk = read as Buffer;
    for (let end = lineEnd(chunk); end >= 0; end = lineEnd(chunk)) {
      hold(chunk.subarray(0, end));
      yield* release(chunk.subarray(end, end + 1));
      chunk = chunk.subarray(end + 1);
    }
    hold(chunk);
  }
  yield* release(Buffer.alloc(0));
}

/** One line as it was read: what was kept of it and how long it is. */
type Line = {
  /** Counted from 1. */
  readonly number: number;
  /** Its characters from `from`, counted from 0, as many as were kept. */
  readonly kept: string;
  readonly from: number;
  /** The characters it holds, or those read of it when it was cut short. */
  readonly length: number;
  /** A line that is not UTF-8, longer than what could be held of it. */
  readonly cut: boolean;
};

/**
 * The lines of a stream of characters, each holding no more of itself than
 * `keep` asks for when it starts, so a line of any length costs a page's
 * memory at most. A line ends at a line feed, a carriage return or the two
 * together; a last line with no characters is no line.
 */
async function* linesOf(
  characters: AsyncIterable<string | typeof lineCutShort>,
  keep: (
    line: number,
  ) => { readonly from: number; readonly most: number } | undefined,
): AsyncGenerator<Line> {
  let number = 0;
  let wanted: { readonly from: number; readonly most: number } | undefined;
  let kept: string[] = [];
  let keptLength = 0;
  let length = 0;
  let cut = false;
  let started = false;
  let afterReturn = false;
  const begin = () => {
    number += 1;
    wanted = keep(number);
    kept = [];
    keptLength = 0;
    length = 0;
    cut = false;
    started = true;
  };
  const take = (text: string) => {
    if (!text) return;
    if (!started) begin();
    if (wanted) {
      const from = Math.max(wanted.from - length, 0);
      const room = wanted.most - keptLength;
      if (from < text.length && room > 0) {
        const piece = text.slice(from, from + room);
        kept.push(piece);
        keptLength += piece.length;
      }
    }
    length += text.length;
  };
  const end = (): Line => {
    started = false;
    return {
      number,
      kept: kept.join(""),
      from: wanted?.from ?? 0,
      length,
      cut,
    };
  };
  for await (const chunk of characters) {
    if (chunk === lineCutShort) {
      cut = true;
      continue;
    }
    let at = 0;
    while (at < chunk.length) {
      if (afterReturn && chunk[at] === "\n") {
        at += 1;
        afterReturn = false;
        continue;
      }
      afterReturn = false;
      let stop = at;
      while (
        stop < chunk.length &&
        chunk[stop] !== "\n" &&
        chunk[stop] !== "\r"
      )
        stop += 1;
      take(chunk.slice(at, stop));
      if (stop === chunk.length) break;
      if (!started) begin();
      afterReturn = chunk[stop] === "\r";
      yield end();
      at = stop + 1;
    }
  }
  if (started) yield end();
}

/** As many characters of a part as fit in `bytes`, never half a pair. */
/**
 * A text's size as the model is sent it, inside a JSON answer: a quote, a
 * backslash or a line break takes two bytes there, a control character six.
 */
function sentBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text), "utf8") - 2;
}

function fitting(text: string, bytes: number): number {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (sentBytes(text.slice(0, middle)) <= bytes) low = middle;
    else high = middle - 1;
  }
  const code = text.charCodeAt(low - 1);
  return code >= 0xd800 && code <= 0xdbff ? low - 1 : low;
}

export async function readPage(
  path: string,
  {
    startLine,
    startCharacter = 1,
    lineCount,
    signal,
    encoding = "utf-8",
    notice = "",
    tokens = pageTokens,
  }: {
    readonly startLine: number;
    /** Where in the first line to start, counted from 1. */
    readonly startCharacter?: number;
    readonly lineCount: number;
    readonly signal?: AbortSignal | undefined;
    /** UTF-8 when not said. */
    readonly encoding?: PageEncoding;
    /** Said before the page; its size comes out of the page's. */
    readonly notice?: string | undefined;
    readonly tokens?: number | undefined;
  },
): Promise<Page> {
  const budget = tokens - reservedTokens - estimatedTokens(notice);
  if (budget < 1) throw new NoRoomError();
  // No more characters can fit in a page than it has bytes, and a page holds
  // at least one character, four bytes at most, so a read always moves on.
  const pageBytes = Math.max(budget * 3, 4);
  const numbered: string[] = [];
  const plain: string[] = [];
  let bytes = 0;
  let full = false;
  let total = 0;
  let wholeFrom: number | undefined;
  let wholeTo: number | undefined;
  let part: Page["part"];
  let after = "";
  let continues = false;
  const lines = linesOf(characters(path, encoding, signal), (number) =>
    number < startLine || full
      ? undefined
      : {
          from: number === startLine ? startCharacter - 1 : 0,
          most: pageBytes,
        },
  );
  for await (const line of lines) {
    total = line.number;
    if (line.number < startLine || full) continue;
    const label = `${line.number}→`;
    const whole =
      line.from === 0 && !line.cut && line.kept.length === line.length;
    if (whole) {
      // With the line break after it, written out as two bytes.
      const cost = sentBytes(`${label}${line.kept}`) + 2;
      if (Math.ceil((bytes + cost) / 3) <= budget) {
        numbered.push(`${label}${line.kept}`);
        plain.push(line.kept);
        bytes += cost;
        wholeFrom ??= line.number;
        wholeTo = line.number;
        if (numbered.length >= lineCount) full = true;
        continue;
      }
      // A line that does not fit after others starts the next page.
      if (numbered.length) {
        full = true;
        continue;
      }
    }
    if (numbered.length) {
      full = true;
      continue;
    }
    // A line read in part: from where it was asked, as much as fits.
    if (line.from >= line.length) {
      part = {
        line: line.number,
        first: line.from + 1,
        last: line.from,
        ...(line.cut ? { held: line.length } : { characters: line.length }),
      };
      full = true;
      continue;
    }
    const room = Math.max(pageBytes - sentBytes(label) - 2, 1);
    // Asked to start inside a character's two halves, the page starts at the
    // character after it.
    const inside = /^[\udc00-\udfff]/.test(line.kept) ? 1 : 0;
    const kept = line.kept.slice(inside);
    const least = /^[\ud800-\udbff][\udc00-\udfff]/.test(kept) ? 2 : 1;
    const shown = kept.slice(0, Math.max(fitting(kept, room), least));
    const last = line.from + inside + shown.length;
    numbered.push(`${label}${shown}`);
    plain.push(shown);
    bytes += sentBytes(`${label}${shown}`) + 2;
    part = {
      line: line.number,
      first: line.from + inside + 1,
      last,
      ...(line.cut ? { held: line.length } : { characters: line.length }),
    };
    const count = line.length.toLocaleString("en-US");
    continues = last < line.length;
    if (continues)
      after = `\n… line ${line.number} continues at character ${(last + 1).toLocaleString("en-US")} of ${line.cut ? `more than ${count}` : count}; call read_file with startLine=${line.number} and startCharacter=${last + 1}`;
    else if (line.cut)
      after = `\n… the rest of line ${line.number} is not shown: in a file that is not UTF-8, a line is read up to its first MiB.`;
    // The rest of the page goes on after a line read to its end.
    if (last < line.length || line.cut || numbered.length >= lineCount)
      full = true;
  }
  const last = numbered.length
    ? startLine + numbered.length - 1
    : startLine - 1;
  const rest =
    !continues && numbered.length && last < total
      ? `\n… lines ${last + 1}–${total.toLocaleString("en-US")} not shown; call read_file with startLine=${last + 1}`
      : "";
  const from =
    startCharacter > 1 && part?.line === startLine && part.last >= part.first
      ? `Line ${startLine} from character ${part.first.toLocaleString("en-US")}:\n`
      : "";
  return {
    text: `${notice}${from}${numbered.join("\n")}${after}${rest}`,
    plain: plain.join("\n"),
    first: startLine,
    last,
    totalLines: total,
    ...(wholeFrom !== undefined && wholeTo !== undefined
      ? { whole: { first: wholeFrom, last: wholeTo } }
      : {}),
    ...(part ? { part } : {}),
  };
}
