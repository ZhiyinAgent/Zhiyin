/**
 * Cutting a file into pieces by its content, with FastCDC (Xia et al., 2016;
 * normalised chunking, level 2): a gear hash rolled over the bytes, cut
 * where its top bits are zero, harder to cut before the average size and
 * easier after. An insert moves only the cuts beside it, so the pieces after
 * it are the same pieces and are kept once.
 */

/** About 256 KiB a piece. */
const averagePiece = 256 * 1024;
const smallestPiece = averagePiece / 4;
const largestPiece = averagePiece * 4;

const bits = Math.log2(averagePiece);
/** The top bits of the 32-bit hash that must be zero, before and after the average. */
const hardMask = -1 << (32 - (bits + 2));
const easyMask = -1 << (32 - (bits - 2));

/** One random 32-bit number per byte value, the same in every run. */
const gear = (() => {
  const table = new Int32Array(256);
  let state = 0x9e3779b9;
  for (let index = 0; index < 256; index++) {
    // xorshift32, seeded once: any fixed table works, but it must never change.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    table[index] = state;
  }
  return table;
})();

/**
 * The length of the piece that starts at `start` in `data`. With `last`, the
 * data ends the file; otherwise a piece is cut only where the data holds a
 * largest piece past `start`, and `undefined` asks for more data.
 */
function pieceLength(
  data: Uint8Array,
  start: number,
  last: boolean,
): number | undefined {
  const left = data.length - start;
  if (left < largestPiece && !last) return undefined;
  if (left <= smallestPiece) return left;
  // Signed 32-bit arithmetic throughout, which the engine keeps in registers.
  const table = gear;
  const end = start + Math.min(left, largestPiece);
  const normal = start + Math.min(averagePiece, left);
  let hash = 0;
  let at = start + smallestPiece;
  for (; at < normal; at++) {
    hash = ((hash << 1) + table[data[at]!]!) | 0;
    if ((hash & hardMask) === 0) return at + 1 - start;
  }
  for (; at < end; at++) {
    hash = ((hash << 1) + table[data[at]!]!) | 0;
    if ((hash & easyMask) === 0) return at + 1 - start;
  }
  return end - start;
}

/**
 * Cuts a stream of blocks into pieces: give it each block in order, and
 * the last with `last`; it answers the pieces each block completed, as views
 * that stay valid until the next call.
 */
export class Chunker {
  #held: Uint8Array = new Uint8Array(0);

  push(block: Uint8Array, last: boolean): Uint8Array[] {
    const data = this.#held.length ? concat(this.#held, block) : block;
    const pieces: Uint8Array[] = [];
    let start = 0;
    while (start < data.length) {
      const length = pieceLength(data, start, last);
      if (length === undefined) break;
      pieces.push(data.subarray(start, start + length));
      start += length;
    }
    // Kept as a copy: the caller may reuse the block it gave. A Buffer's
    // own `slice` is a view, so the copy is made as a plain array's.
    this.#held = Uint8Array.prototype.slice.call(data, start);
    return pieces;
  }
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first, 0);
  joined.set(second, first.length);
  return joined;
}
