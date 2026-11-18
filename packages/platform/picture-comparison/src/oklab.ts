/**
 * A picture's colours in OKLab, where equal distances look about equally
 * different.
 */

import type { Pixels } from "./pixels.js";

const linear = new Float32Array(256).map((_, value) => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
});

/** A picture's lightness and two colour axes, one value a pixel each. */
export type Lab = {
  readonly lightness: Float32Array;
  readonly a: Float32Array;
  readonly b: Float32Array;
};

export function labOf(picture: Pixels): Lab {
  const count = picture.width * picture.height;
  const lightness = new Float32Array(count);
  const a = new Float32Array(count);
  const b = new Float32Array(count);
  const { rgba } = picture;
  for (let index = 0; index < count; index += 1) {
    const r = linear[rgba[index * 4]!]!;
    const g = linear[rgba[index * 4 + 1]!]!;
    const blue = linear[rgba[index * 4 + 2]!]!;
    const l = Math.cbrt(
      0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * blue,
    );
    const m = Math.cbrt(
      0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * blue,
    );
    const s = Math.cbrt(
      0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * blue,
    );
    lightness[index] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    a[index] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    b[index] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  }
  return { lightness, a, b };
}
