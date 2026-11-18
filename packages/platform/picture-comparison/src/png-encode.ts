/**
 * Pixels written as a PNG, here in plain code: what the tools draw for the
 * model is encoded without a native canvas, so nothing in the core decodes or
 * draws with native code.
 */

import { crc32, deflateSync } from "node:zlib";
import type { Pixels } from "./pixels.js";

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * An opaque PNG of the pixels' red, green and blue. Each row takes the filter
 * that leaves the smallest values, as encoders usually choose.
 */
export function encodePng(picture: Pixels): Buffer {
  const { width, height, rgba } = picture;
  const stride = width * 3;
  const rows = Buffer.alloc((stride + 1) * height);
  let previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      current[x * 3] = rgba[from]!;
      current[x * 3 + 1] = rgba[from + 1]!;
      current[x * 3 + 2] = rgba[from + 2]!;
    }
    let chosen = 0;
    let smallest = Infinity;
    for (let filter = 0; filter < 5; filter += 1) {
      const out = candidates[filter]!;
      let total = 0;
      for (let index = 0; index < stride; index += 1) {
        const left = index >= 3 ? current[index - 3]! : 0;
        const up = previous[index]!;
        const upLeft = index >= 3 ? previous[index - 3]! : 0;
        const predicted =
          filter === 0
            ? 0
            : filter === 1
              ? left
              : filter === 2
                ? up
                : filter === 3
                  ? (left + up) >> 1
                  : paeth(left, up, upLeft);
        const value = (current[index]! - predicted) & 0xff;
        out[index] = value;
        total += value < 128 ? value : 256 - value;
      }
      if (total < smallest) {
        smallest = total;
        chosen = filter;
      }
    }
    const at = y * (stride + 1);
    rows[at] = chosen;
    rows.set(candidates[chosen]!, at + 1);
    previous = Uint8Array.from(current);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // red, green and blue
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
