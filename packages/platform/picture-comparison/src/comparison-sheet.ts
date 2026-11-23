/**
 * The sheet a picture comparison is shown as: the first picture and the
 * second side by side, one over the other at half strength each, and where
 * they differ, in red over a pale copy of the first, with the areas boxed and
 * numbered on every panel but the overlay. Drawn in plain code, its labels in
 * a small pixel font, so nothing native draws in the core.
 */

import type { DifferingArea } from "./picture-difference.js";
import type { Pixels } from "./pixels.js";

/** Five by seven glyphs, a row a string, for the few words the sheet says. */
const glyphs: Readonly<Record<string, readonly string[]>> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  N: ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

type Colour = readonly [number, number, number];

const paper: Colour = [236, 236, 236];
const ink: Colour = [34, 34, 34];
const boxColour: Colour = [31, 95, 208];
const white: Colour = [255, 255, 255];
const changeColour: Colour = [215, 25, 25];

/** Space round and between the panels, and the band each label sits in. */
const margin = 12;
const labelBand = 28;
const fontScale = 2;

/** Pixels the sheet is drawn on, opaque. */
class Canvas {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number, background: Colour) {
    this.width = width;
    this.height = height;
    this.rgba = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      this.rgba[index * 4] = background[0];
      this.rgba[index * 4 + 1] = background[1];
      this.rgba[index * 4 + 2] = background[2];
      this.rgba[index * 4 + 3] = 255;
    }
  }

  set(x: number, y: number, colour: Colour, alpha = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const at = (y * this.width + x) * 4;
    for (let k = 0; k < 3; k += 1)
      this.rgba[at + k] = Math.round(
        this.rgba[at + k]! * (1 - alpha) + colour[k]! * alpha,
      );
  }

  fill(x: number, y: number, width: number, height: number, colour: Colour) {
    for (let row = y; row < y + height; row += 1)
      for (let column = x; column < x + width; column += 1)
        this.set(column, row, colour);
  }

  /** A box's outline, `thickness` wide, drawn just outside the rectangle. */
  outline(
    x: number,
    y: number,
    width: number,
    height: number,
    thickness: number,
    colour: Colour,
    clip: { x: number; y: number; width: number; height: number },
  ) {
    for (let t = 1; t <= thickness; t += 1) {
      const left = x - t;
      const top = y - t;
      const right = x + width - 1 + t;
      const bottom = y + height - 1 + t;
      for (let column = left; column <= right; column += 1) {
        this.clipped(column, top, colour, clip);
        this.clipped(column, bottom, colour, clip);
      }
      for (let row = top; row <= bottom; row += 1) {
        this.clipped(left, row, colour, clip);
        this.clipped(right, row, colour, clip);
      }
    }
  }

  clipped(
    x: number,
    y: number,
    colour: Colour,
    clip: { x: number; y: number; width: number; height: number },
  ) {
    if (
      x < clip.x ||
      y < clip.y ||
      x >= clip.x + clip.width ||
      y >= clip.y + clip.height
    )
      return;
    this.set(x, y, colour);
  }

  text(words: string, x: number, y: number, colour: Colour): void {
    let left = x;
    for (const character of words.toUpperCase()) {
      const glyph = glyphs[character] ?? glyphs[" "]!;
      glyph.forEach((row, line) => {
        for (let column = 0; column < row.length; column += 1)
          if (row[column] === "#")
            this.fill(
              left + column * fontScale,
              y + line * fontScale,
              fontScale,
              fontScale,
              colour,
            );
      });
      left += 6 * fontScale;
    }
  }

  draw(picture: Pixels, x: number, y: number): void {
    for (let row = 0; row < picture.height; row += 1)
      for (let column = 0; column < picture.width; column += 1) {
        const from = (row * picture.width + column) * 4;
        const at = ((y + row) * this.width + x + column) * 4;
        this.rgba[at] = picture.rgba[from]!;
        this.rgba[at + 1] = picture.rgba[from + 1]!;
        this.rgba[at + 2] = picture.rgba[from + 2]!;
      }
  }
}

/** How wide a run of the pixel font is. */
function textWidth(words: string): number {
  return words.length * 6 * fontScale - fontScale;
}

/** Each picture blended half and half. */
function overlay(first: Pixels, second: Pixels): Pixels {
  const rgba = new Uint8Array(first.rgba.length);
  for (let index = 0; index < rgba.length; index += 1)
    rgba[index] = (first.rgba[index]! + second.rgba[index]!) >> 1;
  return { rgba, width: first.width, height: first.height };
}

/**
 * The first in pale grey, red laid over where the second differs: faint for
 * a difference just past visible, solid for a wide one.
 */
function differenceMap(
  first: Pixels,
  distance: Float32Array,
  visible: number,
): Pixels {
  const rgba = new Uint8Array(first.rgba.length);
  for (let index = 0; index < first.width * first.height; index += 1) {
    const at = index * 4;
    const grey =
      0.2126 * first.rgba[at]! +
      0.7152 * first.rgba[at + 1]! +
      0.0722 * first.rgba[at + 2]!;
    const pale = 170 + (grey / 255) * 75;
    const value = distance[index]!;
    // None where nothing differs visibly, faint just past it, strong for a
    // difference five times as wide.
    const strength =
      value <= visible
        ? 0
        : Math.min(0.9, 0.12 + ((value - visible) / (visible * 4)) * 0.78);
    for (let k = 0; k < 3; k += 1)
      rgba[at + k] = Math.round(
        pale * (1 - strength) + changeColour[k]! * strength,
      );
    rgba[at + 3] = 255;
  }
  return { rgba, width: first.width, height: first.height };
}

const labels = ["A first", "B second", "A over B", "Where they differ"];
/** A column is never narrower than its longest label, however thin a panel. */
const narrowest = Math.max(...labels.map(textWidth));

/** The size of the sheet for panels of this size drawn at `scale`. */
export function sheetSize(
  panelWidth: number,
  panelHeight: number,
  scale: number,
): { readonly width: number; readonly height: number } {
  const width = Math.max(1, Math.round(panelWidth * scale));
  const height = Math.max(1, Math.round(panelHeight * scale));
  return {
    width: margin * 3 + Math.max(width, narrowest) * 2,
    height: margin * 3 + (labelBand + height) * 2,
  };
}

export type SheetPanels = {
  readonly first: Pixels;
  readonly second: Pixels;
  readonly distance: Float32Array;
  readonly visible: number;
  /** Areas in the compared pixels, numbered from 1 in this order. */
  readonly areas: readonly DifferingArea[];
};

/**
 * The sheet, two panels across and two down, each as large as the compared
 * pictures, or smaller by `scale` when the sheet would be too large to send.
 */
export function comparisonSheet(
  panels: SheetPanels,
  resize: (picture: Pixels, width: number, height: number) => Pixels,
  scale = 1,
): Pixels {
  const width = Math.max(1, Math.round(panels.first.width * scale));
  const height = Math.max(1, Math.round(panels.first.height * scale));
  const fitted = (picture: Pixels) =>
    scale === 1 ? picture : resize(picture, width, height);
  const contents = [
    { label: labels[0]!, picture: fitted(panels.first), boxes: true },
    { label: labels[1]!, picture: fitted(panels.second), boxes: true },
    {
      label: labels[2]!,
      picture: fitted(overlay(panels.first, panels.second)),
      boxes: false,
    },
    {
      label: labels[3]!,
      picture: fitted(
        differenceMap(panels.first, panels.distance, panels.visible),
      ),
      boxes: true,
    },
  ];
  const size = sheetSize(panels.first.width, panels.first.height, scale);
  const sheet = new Canvas(size.width, size.height, paper);
  contents.forEach(({ label, picture, boxes }, index) => {
    const column = index % 2;
    const row = (index - column) / 2;
    const x = margin + column * (Math.max(width, narrowest) + margin);
    const y = margin + row * (labelBand + height + margin);
    sheet.text(label, x, y + (labelBand - 7 * fontScale) / 2 - 2, ink);
    sheet.draw(picture, x, y + labelBand);
    if (!boxes) return;
    const clip = { x, y: y + labelBand, width, height };
    panels.areas.forEach((area, number) => {
      const left = x + Math.round(area.box.x * scale);
      const top = y + labelBand + Math.round(area.box.y * scale);
      const boxWidth = Math.max(1, Math.round(area.box.width * scale));
      const boxHeight = Math.max(1, Math.round(area.box.height * scale));
      sheet.outline(left, top, boxWidth, boxHeight, 2, boxColour, clip);
      // The number in a tag at the box's top left, kept inside the panel.
      const tag = String(number + 1);
      const tagWidth = textWidth(tag) + 6;
      const tagHeight = 7 * fontScale + 6;
      const tagX = Math.min(Math.max(x, left - 2), x + width - tagWidth);
      const tagY = Math.min(
        Math.max(y + labelBand, top - 2 - tagHeight),
        y + labelBand + height - tagHeight,
      );
      sheet.fill(tagX, tagY, tagWidth, tagHeight, boxColour);
      sheet.text(tag, tagX + 3, tagY + 3, white);
    });
  });
  return { rgba: sheet.rgba, width: sheet.width, height: sheet.height };
}
