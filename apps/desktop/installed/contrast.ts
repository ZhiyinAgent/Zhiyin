/**
 * How much a look's picture masks the text drawn over it, measured from two
 * captures of the same region: one in a look without pictures, one in the look.
 *
 * Model (Scharff, Hill & Ahumada, 1999): text keeps an effective contrast
 *     CM = CT / sqrt(1 + (CRMS / 0.05)^2)
 * where CRMS is the RMS luminance variation of the background over the
 * adapting luminance. The paper's backgrounds were light, so its background
 * mean was also the adapting level. On a dark theme the background mean is
 * near zero and the eye adapts to the text and panels as well, so the adapting
 * level here is the mean luminance of the whole region without the picture,
 * in both themes. That is an assumption, not a result of the paper.
 *
 * The background is read only where the capture without pictures is plain
 * ground: away from text, borders and panels by four pixels.
 */

/** A capture as Electron hands it over on Windows: BGRA, row by row. */
export type Capture = {
  readonly width: number;
  readonly height: number;
  readonly bgra: Uint8Array;
};

export type Masking = {
  /** RMS luminance variation of the plain ground over the adapting level. */
  readonly variation: number;
  /** Share of the text's contrast kept, against the capture without pictures. */
  readonly kept: number;
  /**
   * WCAG contrast of the given text colour against the background pixel that
   * is worst for it: the 99th percentile of lightness on a dark theme, the 1st
   * on a light one.
   */
  readonly wcag: number;
  /** How many pixels the ground was read from. */
  readonly pixels: number;
};

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of an sRGB colour, as WCAG defines it. */
function luminance([red, green, blue]: readonly [
  number,
  number,
  number,
]): number {
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

function wcagContrast(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function luminances(capture: Capture): Float64Array {
  const out = new Float64Array(capture.width * capture.height);
  for (let index = 0; index < out.length; index++) {
    const at = index * 4;
    out[index] = luminance([
      capture.bgra[at + 2]!,
      capture.bgra[at + 1]!,
      capture.bgra[at]!,
    ]);
  }
  return out;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)]!;
}

/** The colour most of the region is: the median of each channel. */
function groundColour(capture: Capture): [number, number, number] {
  const [blue, green, red]: number[][] = [[], [], []];
  for (let at = 0; at < capture.bgra.length; at += 4) {
    blue!.push(capture.bgra[at]!);
    green!.push(capture.bgra[at + 1]!);
    red!.push(capture.bgra[at + 2]!);
  }
  return [median(red!), median(green!), median(blue!)];
}

/**
 * Where the capture is plain ground: every channel within 10 levels of the
 * ground colour, eroded four times with the four nearest neighbours.
 */
function plainGround(capture: Capture): Uint8Array {
  const { width, height, bgra } = capture;
  const [red, green, blue] = groundColour(capture);
  let plain = new Uint8Array(width * height);
  for (let index = 0; index < plain.length; index++) {
    const at = index * 4;
    const off = Math.max(
      Math.abs(bgra[at + 2]! - red),
      Math.abs(bgra[at + 1]! - green),
      Math.abs(bgra[at]! - blue),
    );
    plain[index] = off < 10 ? 1 : 0;
  }
  for (let pass = 0; pass < 4; pass++) {
    const next = new Uint8Array(plain.length);
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        next[index] =
          plain[index]! &
          plain[index - 1]! &
          plain[index + 1]! &
          plain[index - width]! &
          plain[index + width]!;
      }
    plain = next;
  }
  return plain;
}

const keptAt = (variation: number) =>
  1 / Math.sqrt(1 + (variation / 0.05) ** 2);

function spread(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );
}

function percentile(values: number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(share * sorted.length))
  ]!;
}

/**
 * How the look's capture masks text of the given colour, against the capture
 * of the same region without pictures.
 */
export function masking(
  without: Capture,
  within: Capture,
  text: readonly [number, number, number],
  dark: boolean,
): Masking {
  if (without.width !== within.width || without.height !== within.height)
    throw new Error(
      `The captures differ in size: ${without.width}×${without.height} and ${within.width}×${within.height}.`,
    );
  const plain = plainGround(without);
  const base = luminances(without);
  const shot = luminances(within);
  const adapt = base.reduce((sum, value) => sum + value, 0) / base.length;
  const plainBase: number[] = [];
  const plainShot: number[] = [];
  for (let index = 0; index < plain.length; index++)
    if (plain[index]) {
      plainBase.push(base[index]!);
      plainShot.push(shot[index]!);
    }
  if (plainShot.length === 0)
    throw new Error("The region has no plain ground to read.");
  const variation = spread(plainShot) / adapt;
  const worst = percentile(plainShot, dark ? 0.99 : 0.01);
  return {
    variation,
    kept: keptAt(variation) / keptAt(spread(plainBase) / adapt),
    wcag: wcagContrast(luminance(text), worst),
    pixels: plainShot.length,
  };
}
