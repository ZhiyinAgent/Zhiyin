/**
 * Each picture's average light and colour, set side by side. These are plain
 * averages over the whole compared picture: they say how much the light and
 * the colour moved, not what kind of edit moved them, which the sheet shows.
 *
 * Colour and its saturation are measured against each pixel's lightness. A
 * change of exposure scales lightness and colour together in OKLab, so it
 * moves the light and leaves these where they were.
 */

import type { Lab } from "./oklab.js";

/** Lightness below which a pixel's colour is too dark to measure against it. */
const tooDark = 0.1;
/** The average CIE lightness under which a picture is nearly black: a grey of 10 in 255 is 2.7. */
const nearlyBlackAverage = 3;

export type Averages = {
  /** Each picture's average CIE lightness, from 0 to 100. */
  readonly lightness: { readonly first: number; readonly second: number };
  /**
   * The second's average luminance as a share of the first's, the light a
   * camera's exposure scales; none when either picture is nearly black.
   */
  readonly lightRatio?: number;
  /**
   * How far the average colour moved, in OKLab at the first's lightness:
   * each pixel's colour against its lightness, averaged.
   */
  readonly colourMove: { readonly a: number; readonly b: number };
  /** Each picture's average chroma, measured the same way. */
  readonly chroma: { readonly first: number; readonly second: number };
};

/**
 * CIE lightness from OKLab's, as for a grey. Its toe near black is straight,
 * so a change there is as small as it looks.
 */
const cieLightness = (oklab: number) =>
  oklab > 0.2069 ? 116 * oklab - 16 : 903.3 * oklab ** 3;

/** One picture's averages: light, and colour against lightness. */
function averagesOne(lab: Lab) {
  const count = lab.lightness.length;
  let cie = 0;
  let luminance = 0;
  let measured = 0;
  let lightness = 0;
  let a = 0;
  let b = 0;
  let chroma = 0;
  for (let index = 0; index < count; index += 1) {
    const l = lab.lightness[index]!;
    cie += cieLightness(l);
    luminance += l ** 3;
    if (l < tooDark) continue;
    measured += 1;
    lightness += l;
    a += lab.a[index]! / l;
    b += lab.b[index]! / l;
    chroma += Math.hypot(lab.a[index]!, lab.b[index]!) / l;
  }
  const per = (sum: number, n: number) => (n ? sum / n : 0);
  return {
    cie: per(cie, count),
    luminance: per(luminance, count),
    lightness: per(lightness, measured),
    a: per(a, measured),
    b: per(b, measured),
    chroma: per(chroma, measured),
  };
}

export function averagesOf(first: Lab, second: Lab): Averages {
  const p = averagesOne(first);
  const q = averagesOne(second);
  const black = (one: typeof p) => one.cie < nearlyBlackAverage;
  // Colour against lightness, put back at the first's lightness.
  const at = p.lightness;
  return {
    lightness: { first: p.cie, second: q.cie },
    ...(black(p) || black(q) ? {} : { lightRatio: q.luminance / p.luminance }),
    colourMove: { a: (q.a - p.a) * at, b: (q.b - p.b) * at },
    chroma: { first: p.chroma * at, second: q.chroma * at },
  };
}
