/**
 * How two pictures of the same size differ, measured from their pixels alone.
 *
 * Colours are compared in OKLab, where equal distances look about equally
 * different, and after a slight blur, so the edge of a shape drawn a pixel
 * apart, or a render's grain, is not taken for a change. Structure is
 * compared by SSIM on lightness. Where the second picture's content is the
 * first's moved or zoomed, as a camera framed differently makes it, the move
 * is found from the two pictures' edges and said as such, since a model
 * matching a reference needs that more than a map of everything that moved.
 */

import type { Pixels } from "./pixels.js";
import { labOf, type Lab } from "./oklab.js";
import { averagesOf, type Averages } from "./averages.js";

/** A rectangle in a picture's pixels, which need not be whole. */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * The OKLab distance taken as visibly different: about twice what a person
 * can just tell apart side by side.
 */
export const visibleDifference = 0.05;
/** An area smaller than this share of the picture is not named on its own. */
const smallestArea = 0.001;
/** The most areas named; the rest are counted. */
const areasNamed = 6;
/** Past this share differing, the areas are where it differs most. */
const mostOfIt = 0.3;
/** An area whose box covers more than this share says little on its own. */
const sprawls = 0.35;

/** The value below which `share` of the values lie. */
function quantile(values: Float32Array, share: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * share))
  ]!;
}

/**
 * `rect` of `source` drawn `width` by `height`: each pixel the average of
 * the source under it, sampled bilinearly, so a picture made smaller keeps
 * its colours and one made larger stays smooth.
 */
export function resample(
  source: Pixels,
  rect: Rect,
  width: number,
  height: number,
): Pixels {
  const out = new Uint8Array(width * height * 4);
  const stepX = rect.width / width;
  const stepY = rect.height / height;
  const samplesX = Math.max(1, Math.ceil(stepX - 1e-9));
  const samplesY = Math.max(1, Math.ceil(stepY - 1e-9));
  const count = samplesX * samplesY;
  const { rgba, width: sw, height: sh } = source;
  const sum = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      sum[0] = sum[1] = sum[2] = 0;
      for (let j = 0; j < samplesY; j += 1) {
        const sy = Math.min(
          sh - 1,
          Math.max(0, rect.y + (y + (j + 0.5) / samplesY) * stepY - 0.5),
        );
        const y0 = Math.floor(sy);
        const y1 = Math.min(sh - 1, y0 + 1);
        const fy = sy - y0;
        for (let i = 0; i < samplesX; i += 1) {
          const sx = Math.min(
            sw - 1,
            Math.max(0, rect.x + (x + (i + 0.5) / samplesX) * stepX - 0.5),
          );
          const x0 = Math.floor(sx);
          const x1 = Math.min(sw - 1, x0 + 1);
          const fx = sx - x0;
          const a = (y0 * sw + x0) * 4;
          const b = (y0 * sw + x1) * 4;
          const c = (y1 * sw + x0) * 4;
          const d = (y1 * sw + x1) * 4;
          for (let k = 0; k < 3; k += 1) {
            const top = rgba[a + k]! * (1 - fx) + rgba[b + k]! * fx;
            const bottom = rgba[c + k]! * (1 - fx) + rgba[d + k]! * fx;
            sum[k]! += top * (1 - fy) + bottom * fy;
          }
        }
      }
      const at = (y * width + x) * 4;
      out[at] = Math.round(sum[0]! / count);
      out[at + 1] = Math.round(sum[1]! / count);
      out[at + 2] = Math.round(sum[2]! / count);
      out[at + 3] = 255;
    }
  }
  return { rgba: out, width, height };
}

/** A separable blur with the given weights, edges held at their last pixel. */
function blur(
  values: Float32Array,
  width: number,
  height: number,
  weights: readonly number[],
): Float32Array {
  const radius = (weights.length - 1) / 2;
  const across = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const at = Math.min(width - 1, Math.max(0, x + k));
        sum += values[y * width + at]! * weights[k + radius]!;
      }
      across[y * width + x] = sum;
    }
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const at = Math.min(height - 1, Math.max(0, y + k));
        sum += across[at * width + x]! * weights[k + radius]!;
      }
      out[y * width + x] = sum;
    }
  return out;
}

function gaussian(sigma: number, radius: number): number[] {
  const weights = Array.from({ length: radius * 2 + 1 }, (_, index) =>
    Math.exp(-((index - radius) ** 2) / (2 * sigma * sigma)),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

const ssimWindow = gaussian(1.5, 5);
const box3 = [1 / 3, 1 / 3, 1 / 3];

/**
 * SSIM of two lightness maps, pixel by pixel: 1 where they match in
 * brightness, contrast and structure.
 */
function ssimMap(
  first: Float32Array,
  second: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const count = first.length;
  const product = (p: Float32Array, q: Float32Array) => {
    const out = new Float32Array(count);
    for (let index = 0; index < count; index += 1)
      out[index] = p[index]! * q[index]!;
    return out;
  };
  const meanA = blur(first, width, height, ssimWindow);
  const meanB = blur(second, width, height, ssimWindow);
  const squareA = blur(product(first, first), width, height, ssimWindow);
  const squareB = blur(product(second, second), width, height, ssimWindow);
  const cross = blur(product(first, second), width, height, ssimWindow);
  // Lightness runs from 0 to 1.
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  const map = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const ma = meanA[index]!;
    const mb = meanB[index]!;
    const va = Math.max(0, squareA[index]! - ma * ma);
    const vb = Math.max(0, squareB[index]! - mb * mb);
    const cov = cross[index]! - ma * mb;
    map[index] =
      ((2 * ma * mb + c1) * (2 * cov + c2)) /
      ((ma * ma + mb * mb + c1) * (va + vb + c2));
  }
  return map;
}

function meanOf(values: Float32Array, mask?: Uint8Array): number {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (mask && !mask[index]) continue;
    sum += values[index]!;
    count += 1;
  }
  return count ? sum / count : 1;
}

/** One area where the pictures differ, in the compared pixels. */
export type DifferingArea = {
  readonly box: Rect;
  /** Its pixels that differ, as a share of the picture. */
  readonly share: number;
  /** The colour there in each picture: each channel's middle value. */
  readonly first: readonly [number, number, number];
  readonly second: readonly [number, number, number];
};

/** How the second's content sits against the first's. */
type Alignment = {
  /** Its move, as shares of the width and the height; right and down. */
  readonly right: number;
  readonly down: number;
  /** How much larger it looks, as a factor. */
  readonly scale: number;
  /** SSIM where the two overlap once the second is moved back. */
  readonly similarityAligned: number;
};

export type Difference = {
  /** SSIM of the two lightness maps; 1 is the same picture. */
  readonly similarity: number;
  /** Each pixel's OKLab distance, after the slight blur. */
  readonly distance: Float32Array;
  /** The share of the picture whose pixels differ visibly. */
  readonly changed: number;
  /** The average OKLab distance between the two, after the slight blur. */
  readonly averageDistance: number;
  /** The areas that differ, the most different first. */
  readonly areas: readonly DifferingArea[];
  /** Areas that differ too, smaller than those named. */
  readonly moreAreas: number;
  /**
   * Most of the picture differs, or one area spans much of it, so the areas
   * are where it differs most rather than everywhere it differs. Never when
   * no part differs more than the rest.
   */
  readonly strongest: boolean;
  /** Each picture's average light and colour, over the whole of it. */
  readonly averages: Averages;
  readonly alignment?: Alignment;
};

/** Grows a mask by `radius` pixels in every direction. */
function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const pass = (source: Uint8Array, along: "x" | "y") => {
    const out = new Uint8Array(source.length);
    const lines = along === "x" ? height : width;
    const length = along === "x" ? width : height;
    const at = (line: number, position: number) =>
      along === "x" ? line * width + position : position * width + line;
    for (let line = 0; line < lines; line += 1) {
      let count = 0;
      for (let position = 0; position < Math.min(length, radius); position += 1)
        count += source[at(line, position)]!;
      for (let position = 0; position < length; position += 1) {
        const enter = position + radius;
        const leave = position - radius - 1;
        if (enter < length) count += source[at(line, enter)]!;
        if (leave >= 0) count -= source[at(line, leave)]!;
        out[at(line, position)] = count > 0 ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(mask, "x"), "y");
}

/**
 * The areas where the pictures differ: found where the blurred pictures
 * differ, so a change is not split by its own grain, and measured by the
 * pixels that differ unblurred too, so a box and its colours are the
 * change's own and not the blur's spread round it.
 */
function differingAreas(
  first: Pixels,
  second: Pixels,
  distance: Float32Array,
  changed: Uint8Array,
  sharp: Uint8Array,
): { readonly areas: DifferingArea[]; readonly more: number } {
  const { width, height } = first;
  const total = width * height;
  const grown = dilate(
    changed,
    width,
    height,
    Math.max(1, Math.round(Math.max(width, height) * 0.008)),
  );
  const labels = new Int32Array(total).fill(-1);
  const found: (DifferingArea & { readonly weight: number })[] = [];
  const stack: number[] = [];
  for (let start = 0; start < total; start += 1) {
    if (!grown[start] || labels[start] !== -1) continue;
    const label = found.length;
    labels[start] = label;
    stack.push(start);
    let count = 0;
    let weight = 0;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    // A histogram per channel and picture, for each one's middle value.
    const counts = new Uint32Array(6 * 256);
    while (stack.length) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      if (changed[index] && sharp[index]) {
        count += 1;
        weight += distance[index]!;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        for (let k = 0; k < 3; k += 1) {
          counts[k * 256 + first.rgba[index * 4 + k]!]! += 1;
          counts[(3 + k) * 256 + second.rgba[index * 4 + k]!]! += 1;
        }
      }
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!grown[next] || labels[next] !== -1) continue;
          labels[next] = label;
          stack.push(next);
        }
    }
    const middle = (channel: number) => {
      let seen = 0;
      for (let value = 0; value < 256; value += 1) {
        seen += counts[channel * 256 + value]!;
        if (seen * 2 >= count) return value;
      }
      return 255;
    };
    const colourOf = (offset: number) =>
      [middle(offset), middle(offset + 1), middle(offset + 2)] as const;
    found.push({
      box: {
        x: left,
        y: top,
        width: right - left + 1,
        height: bottom - top + 1,
      },
      share: count / total,
      first: colourOf(0),
      second: colourOf(3),
      weight,
    });
  }
  const kept = found
    .filter(({ share }) => share >= smallestArea && share * total >= 4)
    .sort((p, q) => q.weight - p.weight);
  return {
    areas: kept
      .slice(0, areasNamed)
      .map(({ box, share, first, second }) => ({ box, share, first, second })),
    more: Math.max(0, kept.length - areasNamed),
  };
}

/** A lightness map made `width` by `height` by averaging, for the search. */
function shrink(
  values: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * sourceHeight) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * sourceWidth) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sourceWidth) / width));
      let sum = 0;
      for (let sy = y0; sy < y1; sy += 1)
        for (let sx = x0; sx < x1; sx += 1)
          sum += values[sy * sourceWidth + sx]!;
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** How strongly lightness changes at each pixel, after a light blur. */
function edges(values: Float32Array, width: number, height: number) {
  const smooth = blur(values, width, height, gaussian(1, 2));
  const out = new Float32Array(values.length);
  const at = (x: number, y: number) =>
    smooth[
      Math.min(height - 1, Math.max(0, y)) * width +
        Math.min(width - 1, Math.max(0, x))
    ]!;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const gx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x - 1, y) -
        at(x - 1, y + 1);
      const gy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1);
      out[y * width + x] = Math.hypot(gx, gy);
    }
  return out;
}

/** The long side of the first, coarse search, and of the fine one after it. */
const coarseSide = 96;
const fineSide = 192;
/** The zooms a move is said for, and the farthest move, as a share of a side. */
const smallest = 0.8;
const largest = 1.25;
const farthestMove = 0.15;
/**
 * The coarse search looks a step past each bound, so a zoom or a move just
 * inside it is found at its best, and one beyond it is seen to be beyond and
 * left unsaid rather than reported as the bound.
 */
const scales = [0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3];
const searchedMove = farthestMove + 0.03;
/** How finely the fine search tries zooms. */
const fineScaleStep = 0.0125;
/**
 * How well the moved second's edges must match the first's for a move to be
 * what separates them: a picture moved or zoomed in its frame matches near
 * 1, and a camera turned or moved round a scene, whose parallax no move
 * undoes, matches far less (measured: 0.94 and 0.51).
 */
const isAMove = 0.7;
/** How much better than none a move must match to be said. */
const clearlyBetter = 0.1;

/** The edges of a lightness map shrunk so its long side is `side`. */
function edgeMap(lab: Lab, width: number, height: number, side: number) {
  // The long side `side` long, and the short one at least a quarter of it,
  // so a move along a wide picture's short side is measured as finely.
  const scale = Math.min(
    1,
    Math.max(
      side / Math.max(width, height),
      side / 4 / Math.min(width, height),
    ),
  );
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  return { map: edges(shrink(lab.lightness, width, height, w, h), w, h), w, h };
}

/**
 * How well the second's edges match the first's moved and zoomed about the
 * middle: the second at `p` shows what the first shows at
 * `(p - middle - move) / scale + middle`. Moves are shares of each side.
 */
function correlationOf(
  first: Float32Array,
  second: Float32Array,
  width: number,
  height: number,
  scale: number,
  right: number,
  down: number,
): number {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const dx = right * width;
  const dy = down * height;
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = 0; y < height; y += 1) {
    const ay = Math.round((y - cy - dy) / scale + cy);
    if (ay < 0 || ay >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const ax = Math.round((x - cx - dx) / scale + cx);
      if (ax < 0 || ax >= width) continue;
      const va = first[ay * width + ax]!;
      const vb = second[y * width + x]!;
      n += 1;
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  }
  if (n < width * height * 0.5) return -1;
  const cov = sab - (sa * sb) / n;
  const spread = Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n));
  return spread > 0 ? cov / spread : -1;
}

type Fit = {
  readonly scale: number;
  readonly right: number;
  readonly down: number;
  readonly score: number;
};

/** The best of the candidates, each move a whole pixel of the map. */
function searched(
  first: Float32Array,
  second: Float32Array,
  width: number,
  height: number,
  candidates: {
    readonly scales: readonly number[];
    readonly right: readonly [number, number];
    readonly down: readonly [number, number];
  },
  start: Fit,
): Fit {
  let best = start;
  const fromX = Math.round(candidates.right[0] * width);
  const toX = Math.round(candidates.right[1] * width);
  const fromY = Math.round(candidates.down[0] * height);
  const toY = Math.round(candidates.down[1] * height);
  for (const scale of candidates.scales)
    for (let dy = fromY; dy <= toY; dy += 1)
      for (let dx = fromX; dx <= toX; dx += 1) {
        const score = correlationOf(
          first,
          second,
          width,
          height,
          scale,
          dx / width,
          dy / height,
        );
        if (score > best.score)
          best = { scale, right: dx / width, down: dy / height, score };
      }
  return best;
}

function alignmentOf(
  firstLab: Lab,
  secondLab: Lab,
  width: number,
  height: number,
): Alignment | undefined {
  const coarseA = edgeMap(firstLab, width, height, coarseSide);
  const coarseB = edgeMap(secondLab, width, height, coarseSide);
  const none = correlationOf(
    coarseA.map,
    coarseB.map,
    coarseA.w,
    coarseA.h,
    1,
    0,
    0,
  );
  const coarse = searched(
    coarseA.map,
    coarseB.map,
    coarseA.w,
    coarseA.h,
    {
      scales,
      right: [-searchedMove, searchedMove],
      down: [-searchedMove, searchedMove],
    },
    { scale: 1, right: 0, down: 0, score: none },
  );
  // The fine pass: twice the detail, round the coarse answer, which for a
  // move of a pixel or two of the coarse map is no move at all.
  const fineA = edgeMap(firstLab, width, height, fineSide);
  const fineB = edgeMap(secondLab, width, height, fineSide);
  const stepX = 1 / coarseA.w;
  const stepY = 1 / coarseA.h;
  const fineNone = correlationOf(
    fineA.map,
    fineB.map,
    fineA.w,
    fineA.h,
    1,
    0,
    0,
  );
  const best = searched(
    fineA.map,
    fineB.map,
    fineA.w,
    fineA.h,
    {
      scales: [-2, -1, 0, 1, 2].map(
        (steps) => coarse.scale + steps * fineScaleStep,
      ),
      right: [coarse.right - stepX, coarse.right + stepX],
      down: [coarse.down - stepY, coarse.down + stepY],
    },
    {
      ...coarse,
      score: correlationOf(
        fineA.map,
        fineB.map,
        fineA.w,
        fineA.h,
        coarse.scale,
        coarse.right,
        coarse.down,
      ),
    },
  );
  const still =
    best.right === 0 && best.down === 0 && Math.abs(best.scale - 1) < 1e-9;
  if (still || best.score < isAMove || best.score - fineNone < clearlyBetter)
    return undefined;
  // The move between the map's pixels, from how well the neighbours on
  // each side match: the top of a parabola through the three.
  const scoreAt = (right: number, down: number) =>
    correlationOf(
      fineA.map,
      fineB.map,
      fineA.w,
      fineA.h,
      best.scale,
      right,
      down,
    );
  const between = (before: number, after: number) => {
    const bend = before - 2 * best.score + after;
    return bend < 0
      ? Math.max(-0.5, Math.min(0.5, (before - after) / (2 * bend)))
      : 0;
  };
  const right =
    best.right +
    between(
      scoreAt(best.right - 1 / fineA.w, best.down),
      scoreAt(best.right + 1 / fineA.w, best.down),
    ) /
      fineA.w;
  const down =
    best.down +
    between(
      scoreAt(best.right, best.down - 1 / fineA.h),
      scoreAt(best.right, best.down + 1 / fineA.h),
    ) /
      fineA.h;
  // Within the bounds by a hair, and the zoom by half the fine search's step,
  // which a zoom right at a bound may land on.
  const beyond =
    best.scale < smallest - fineScaleStep / 2 - 1e-9 ||
    best.scale > largest + fineScaleStep / 2 + 1e-9 ||
    Math.abs(right) > farthestMove + 0.005 ||
    Math.abs(down) > farthestMove + 0.005;
  if (beyond) return undefined;
  // The second moved back onto the first, sampled smoothly, and compared
  // where they overlap, away from its edge by the SSIM window's reach.
  const moveX = right * width;
  const moveY = down * height;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const back = new Float32Array(width * height);
  const inside = new Uint8Array(width * height);
  const reach = (ssimWindow.length - 1) / 2;
  const lightness = secondLab.lightness;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const bx = (x - cx) * best.scale + cx + moveX;
      const by = (y - cy) * best.scale + cy + moveY;
      const x0 = Math.floor(bx);
      const y0 = Math.floor(by);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) continue;
      const fx = bx - x0;
      const fy = by - y0;
      const at = y0 * width + x0;
      back[y * width + x] =
        (lightness[at]! * (1 - fx) + lightness[at + 1]! * fx) * (1 - fy) +
        (lightness[at + width]! * (1 - fx) + lightness[at + width + 1]! * fx) *
          fy;
      inside[y * width + x] = 1;
    }
  // Kept only where the whole window lies inside the overlap.
  const kept = new Uint8Array(width * height);
  for (let y = reach; y < height - reach; y += 1)
    for (let x = reach; x < width - reach; x += 1)
      if (
        inside[(y - reach) * width + x - reach] &&
        inside[(y - reach) * width + x + reach] &&
        inside[(y + reach) * width + x - reach] &&
        inside[(y + reach) * width + x + reach]
      )
        kept[y * width + x] = 1;
  // A move that leaves no whole window in the overlap cannot be measured.
  if (!kept.some(Boolean)) return undefined;
  const map = ssimMap(firstLab.lightness, back, width, height);
  return {
    right,
    down,
    scale: best.scale,
    similarityAligned: meanOf(map, kept),
  };
}

/** Two pictures of the same size compared. */
export function differenceOf(first: Pixels, second: Pixels): Difference {
  const { width, height } = first;
  const firstLab = labOf(first);
  const secondLab = labOf(second);
  const similarity = meanOf(
    ssimMap(firstLab.lightness, secondLab.lightness, width, height),
  );
  const smooth = (lab: Lab) => ({
    lightness: blur(lab.lightness, width, height, box3),
    a: blur(lab.a, width, height, box3),
    b: blur(lab.b, width, height, box3),
  });
  const p = smooth(firstLab);
  const q = smooth(secondLab);
  const count = width * height;
  const distance = new Float32Array(count);
  const changed = new Uint8Array(count);
  let changedCount = 0;
  for (let index = 0; index < count; index += 1) {
    const value = Math.hypot(
      p.lightness[index]! - q.lightness[index]!,
      p.a[index]! - q.a[index]!,
      p.b[index]! - q.b[index]!,
    );
    distance[index] = value;
    if (value > visibleDifference) {
      changed[index] = 1;
      changedCount += 1;
    }
  }
  // Areas found where the pictures differ visibly. When most of the picture
  // differs, or an area would span a large part of it, they say little: the
  // areas are then where it differs most, the tenth that differs widest.
  const areasAt = (marked: Uint8Array) => {
    const sharp = new Uint8Array(count);
    for (let index = 0; index < count; index += 1)
      if (
        marked[index] &&
        Math.hypot(
          firstLab.lightness[index]! - secondLab.lightness[index]!,
          firstLab.a[index]! - secondLab.a[index]!,
          firstLab.b[index]! - secondLab.b[index]!,
        ) > visibleDifference
      )
        sharp[index] = 1;
    return differingAreas(first, second, distance, marked, sharp);
  };
  const visible = areasAt(changed);
  const sprawling = visible.areas.some(
    ({ box }) => (box.width * box.height) / count > sprawls,
  );
  let strongest = changedCount / count > mostOfIt || sprawling;
  let found = visible;
  if (strongest) {
    // The tenth of the picture that differs most, or the half of what
    // differs when that is less, never fainter than visibly. A change as
    // strong all across has no such part: its areas are then everywhere it
    // differs, however large.
    const most = Math.min(0.1, changedCount / count / 2);
    const bar = Math.max(visibleDifference, quantile(distance, 1 - most));
    const widest = new Uint8Array(count);
    for (let index = 0; index < count; index += 1)
      if (distance[index]! > bar) widest[index] = 1;
    const strongestAreas = areasAt(widest);
    if (strongestAreas.areas.length) found = strongestAreas;
    else strongest = false;
  }
  const { areas, more } = found;
  const alignment = changedCount
    ? alignmentOf(firstLab, secondLab, width, height)
    : undefined;
  return {
    similarity,
    distance,
    changed: changedCount / count,
    averageDistance: meanOf(distance),
    areas,
    moreAreas: more,
    strongest,
    averages: averagesOf(firstLab, secondLab),
    ...(alignment ? { alignment } : {}),
  };
}
