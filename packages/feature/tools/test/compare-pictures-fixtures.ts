/**
 * What the picture comparison tests share: the pictures they draw, the
 * workspace they compare in, and readers for what a comparison answers.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { loadCanvas } from "@zhiyin/pdf-engine";
import { TemporaryFolders } from "@zhiyin/test-support";
import { ToolsDecodingHere } from "./decoding-here.js";
import type { PixelComparer } from "@zhiyin/picture-comparison";
import type { PixelSource } from "../src/documents/picture-pixels.js";

export const folders = new TemporaryFolders();

export type Context = {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { readonly data: Uint8ClampedArray };
};

/**
 * A scene with structure a comparison can hold on to: a sky, a ground, a sun
 * and three blocks, drawn at any size and optionally moved, zoomed or changed.
 */
export function scene(
  width: number,
  height: number,
  options: {
    readonly shift?: { readonly x: number; readonly y: number };
    readonly zoom?: number;
    readonly paint?: (context: Context, width: number, height: number) => void;
    readonly darker?: number;
    readonly recolour?: (
      r: number,
      g: number,
      b: number,
    ) => [number, number, number];
  } = {},
): Buffer {
  const canvas = loadCanvas().createCanvas(width, height);
  const context = canvas.getContext("2d") as unknown as Context & {
    translate(x: number, y: number): void;
    scale(x: number, y: number): void;
  };
  context.fillStyle = "#9cc8ee";
  context.fillRect(0, 0, width, height);
  const zoom = options.zoom ?? 1;
  context.translate(width / 2, height / 2);
  context.scale(zoom, zoom);
  context.translate(-width / 2, -height / 2);
  context.translate(
    (options.shift?.x ?? 0) * width,
    (options.shift?.y ?? 0) * height,
  );
  context.fillStyle = "#6a9a4a";
  context.fillRect(-width, height * 0.62, width * 3, height);
  context.fillStyle = "#f4d03f";
  context.beginPath();
  context.arc(width * 0.8, height * 0.2, height * 0.09, 0, Math.PI * 2);
  context.fill();
  const blocks: [number, number, number, number, string][] = [
    [0.12, 0.38, 0.14, 0.26, "#a0522d"],
    [0.36, 0.3, 0.18, 0.34, "#7f8c8d"],
    [0.64, 0.44, 0.1, 0.2, "#2c3e50"],
  ];
  for (const [x, y, w, h, colour] of blocks) {
    context.fillStyle = colour;
    context.fillRect(x * width, y * height, w * width, h * height);
  }
  const plain = context as unknown as Context;
  options.paint?.(plain, width, height);
  if (options.darker) {
    context.fillStyle = `rgba(0, 0, 0, ${options.darker})`;
    // Undo the transforms' effect by covering far past the picture.
    context.fillRect(-width * 2, -height * 2, width * 5, height * 5);
  }
  if (options.recolour) {
    const drawn = plain.getImageData(0, 0, width, height);
    const data = drawn.data;
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b] = options.recolour(
        data[index]!,
        data[index + 1]!,
        data[index + 2]!,
      );
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
    }
    (
      context as unknown as {
        putImageData(data: unknown, x: number, y: number): void;
      }
    ).putImageData(drawn, 0, 0);
  }
  return canvas.toBuffer("image/png");
}

/** Each pixel's light multiplied by `times`, as a camera's exposure changes it. */
export const exposed =
  (times: number) =>
  (r: number, g: number, b: number): [number, number, number] =>
    [r, g, b].map((value) => {
      const v = value / 255;
      const linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      const out = Math.min(1, linear * times);
      return (
        255 *
        (out <= 0.0031308 ? out * 12.92 : 1.055 * out ** (1 / 2.4) - 0.055)
      );
    }) as [number, number, number];

/** A picture whose every pixel is `colour` of its place, a PNG. */
export function painted(
  width: number,
  height: number,
  colour: (x: number, y: number) => [number, number, number],
): Buffer {
  const canvas = loadCanvas().createCanvas(width, height);
  const context = canvas.getContext("2d") as unknown as Context & {
    putImageData(data: unknown, x: number, y: number): void;
  };
  const drawn = context.getImageData(0, 0, width, height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const [r, g, b] = colour(x, y);
      drawn.data[at] = r;
      drawn.data[at + 1] = g;
      drawn.data[at + 2] = b;
      drawn.data[at + 3] = 255;
    }
  context.putImageData(drawn, 0, 0);
  return canvas.toBuffer("image/png");
}

/** A colour from its hue in degrees, saturation and value, each channel up to `top`. */
export function hsv(
  hue: number,
  saturation: number,
  value: number,
): [number, number, number] {
  const k = (n: number) => (n + hue / 60) % 6;
  const f = (n: number) =>
    value * (1 - saturation * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
  return [f(5), f(3), f(1)];
}

export async function workspace(files: Record<string, Buffer | string>) {
  const root = await folders.make("zhiyin-compare-");
  for (const [name, contents] of Object.entries(files))
    await writeFile(join(root, name), contents);
  return root;
}

export async function compare(
  files: Record<string, Buffer | string>,
  args: Record<string, unknown>,
  options: {
    readonly acceptsImages?: boolean;
    readonly pixels?: PixelSource;
    readonly comparer?: PixelComparer;
    readonly signal?: AbortSignal;
  } = {},
) {
  const tools = new ToolsDecodingHere(await workspace(files), {
    acceptsImages: () => options.acceptsImages ?? true,
    ...(options.pixels ? { pixels: options.pixels } : {}),
    ...(options.comparer ? { comparer: options.comparer } : {}),
  });
  return tools.execute("compare_pictures", args, options.signal);
}

export type Comparison = {
  readonly similarity: number;
  readonly averageDifference: number;
  readonly differs: string;
  readonly moreAreas?: string;
  readonly areas?: readonly {
    readonly area: number;
    readonly where: string;
    readonly share: string;
    readonly box: {
      readonly left: number;
      readonly top: number;
      readonly width: number;
      readonly height: number;
    };
    readonly first: string;
    readonly second: string;
  }[];
  readonly overall?: readonly string[];
  readonly alignment?: {
    readonly right: number;
    readonly down: number;
    readonly larger: number;
    readonly similarityAligned: number;
  };
  readonly fitted?: string;
  readonly first: string;
  readonly compared: string;
  readonly picture?: string;
};

export function valueOf(result: unknown): Comparison {
  expect(result).toMatchObject({ ok: true });
  return (result as { value: Comparison }).value;
}

/** The sheet's pixels, decoded here only to check what it shows. */
export async function sheetOf(result: unknown) {
  const images = (result as { images?: { data: string }[] }).images ?? [];
  expect(images).toHaveLength(1);
  const canvasModule = loadCanvas();
  const image = await canvasModule.loadImage(
    Buffer.from(images[0]!.data, "base64"),
  );
  const canvas = canvasModule.createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, image.width, image.height);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

export const red = (context: Context, width: number, height: number) => {
  context.fillStyle = "#e01010";
  context.fillRect(width * 0.12, height * 0.7, width * 0.2, height * 0.15);
};
