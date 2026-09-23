/**
 * What a program printed, bounded while it runs rather than after.
 *
 * Only the start and the end of an output are ever kept: a command that prints
 * without end must not become a string the size of the disk. The two ends are
 * decoded as UTF-8 when they are UTF-8, and otherwise in the console's own
 * code page, which is what a Windows console program writes by default.
 */

import { open } from "node:fs/promises";
import { oemText } from "./windows.js";

/** Characters of output kept when a caller does not say. */
export const defaultOutputCharacters = 400_000;

/**
 * Bytes a run may print, across both streams, before it is stopped. Well past
 * any output worth reading, well short of filling a disk.
 */
export const defaultOutputBytes = 64 * 1024 * 1024;

/** How often a contained run's output files are measured. */
export const outputCheckMs = 250;

/** Stands where the middle of a long output was left out. */
export const shortenedMarker = "\n… output shortened …\n";

/** The first `edge` bytes and the last `edge` bytes of a stream. */
export class OutputEnds {
  readonly #edge: number;
  #head = Buffer.alloc(0);
  #tail: Buffer[] = [];
  #tailBytes = 0;
  total = 0;

  constructor(edge: number) {
    this.#edge = edge;
  }

  add(chunk: Buffer): void {
    this.total += chunk.length;
    const room = this.#edge - this.#head.length;
    if (room > 0) {
      this.#head = Buffer.concat([this.#head, chunk.subarray(0, room)]);
      chunk = chunk.subarray(room);
    }
    if (!chunk.length) return;
    this.#tail.push(chunk);
    this.#tailBytes += chunk.length;
    while (this.#tailBytes - (this.#tail[0]?.length ?? 0) >= this.#edge) {
      this.#tailBytes -= this.#tail.shift()?.length ?? 0;
    }
  }

  text(): string {
    const tail = Buffer.concat(this.#tail);
    return joined(
      this.#head,
      tail.subarray(Math.max(0, tail.length - this.#edge)),
      this.total,
    );
  }
}

/**
 * The ends of an output file, read through a handle so that nothing between
 * them is ever loaded.
 */
export async function fileEnds(path: string, edge: number): Promise<string> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return "";
  }
  try {
    const { size } = await handle.stat();
    const read = async (position: number, length: number) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return buffer.subarray(0, bytesRead);
    };
    const head = await read(0, Math.min(size, edge));
    const tailLength = Math.min(Math.max(size - edge, 0), edge);
    const tail = await read(size - tailLength, tailLength);
    return joined(head, tail, size);
  } finally {
    await handle.close();
  }
}

/** The kept ends as text, with the marker between them when bytes were left out. */
function joined(head: Buffer, tail: Buffer, total: number): string {
  if (head.length + tail.length >= total)
    return decoded(Buffer.concat([head, tail]));
  const start = withoutPartialEnd(head);
  const end = withoutPartialStart(tail);
  const utf8 = isUtf8(start) && isUtf8(end);
  return `${decoded(start, utf8)}${shortenedMarker}${decoded(end, utf8)}`;
}

function isUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function decoded(bytes: Buffer, utf8 = isUtf8(bytes)): string {
  return (utf8 ? undefined : oemText(bytes)) ?? bytes.toString("utf8");
}

/** A cut after the head may split a character; the split piece goes. */
function withoutPartialEnd(bytes: Buffer): Buffer {
  for (let back = 1; back <= Math.min(3, bytes.length); back += 1) {
    const byte = bytes[bytes.length - back] ?? 0;
    if ((byte & 0xc0) === 0x80) continue;
    const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return width > back ? bytes.subarray(0, bytes.length - back) : bytes;
  }
  return bytes;
}

/** A cut before the tail may start mid-character; the orphaned bytes go. */
function withoutPartialStart(bytes: Buffer): Buffer {
  let skip = 0;
  while (skip < 3 && ((bytes[skip] ?? 0) & 0xc0) === 0x80) skip += 1;
  return bytes.subarray(skip);
}
