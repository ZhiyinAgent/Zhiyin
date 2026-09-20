/**
 * Brings a picture inside the size a model will accept, and says what it did.
 *
 * A picture past the limit used to be refused outright, which told the agent
 * only that it had failed. What it needs to know is what the picture is of and
 * how well it can be seen: a whole page reduced to fit is often exactly what
 * was wanted, and sometimes it is a strip too thin for any text to survive.
 * Both are useful answers; neither is an error.
 *
 * Boundaries and invariants: docs/architecture/features/tools/README.md
 */

import { createRequire } from "node:module";
import type {
  FittedPicture,
  PictureFitting,
  ProducedImage,
} from "@zhiyin/contract";
import { imageSize, maximumImagePixels } from "./image-size.js";

type CanvasModule = {
  createCanvas(
    width: number,
    height: number,
  ): {
    getContext(kind: "2d"): {
      drawImage(
        image: unknown,
        x: number,
        y: number,
        width: number,
        height: number,
      ): void;
    };
    toBuffer(mediaType: "image/png"): Buffer;
  };
  loadImage(source: Buffer): Promise<unknown>;
};

function loadCanvas(): CanvasModule {
  const require = createRequire(import.meta.url);
  return require("@napi-rs/canvas") as CanvasModule;
}

/**
 * How far from square a picture may be before shrinking it to fit destroys
 * what it is a picture of. A full-page screenshot of a long page arrives at
 * around 1:16; at that shape, fitting the long side inside the limit leaves
 * the short side a few hundred pixels wide and its text a smear.
 */
const readableRatio = 6;

/**
 * Below this, a fitted picture has lost so much that offering it as an answer
 * would mislead more than it informs.
 */
const uselessScale = 0.05;

function describe(width: number, height: number): string {
  return `${width} by ${height}`;
}

export class CanvasPictureFitting implements PictureFitting {
  readonly #maximumPixels: number;

  constructor(options: { readonly maximumPixels?: number } = {}) {
    this.#maximumPixels = options.maximumPixels ?? maximumImagePixels;
  }

  async fit(image: ProducedImage): Promise<FittedPicture> {
    const bytes = Buffer.from(image.data, "base64");
    const size = imageSize(bytes);
    // A picture whose header this does not read is sent as it came: guessing
    // at its size to shrink it would be worse than letting the provider judge.
    if (!size) return { status: "unchanged", image };
    const longest = Math.max(size.width, size.height);
    if (longest <= this.#maximumPixels) return { status: "unchanged", image };

    const scale = this.#maximumPixels / longest;
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    const ratio =
      Math.max(size.width, size.height) /
      Math.max(1, Math.min(size.width, size.height));
    const sizes = `${describe(size.width, size.height)} pixels, which is larger than the ${this.#maximumPixels} this model accepts on a side`;

    if (scale < uselessScale)
      return {
        status: "unusable",
        note: `This picture is ${sizes}. Reduced enough to send, nothing in it would be legible, so it was not sent. Capture a smaller region instead.`,
      };

    let resized: Buffer;
    try {
      const canvas = loadCanvas();
      const source = await canvas.loadImage(bytes);
      const target = canvas.createCanvas(width, height);
      target.getContext("2d").drawImage(source, 0, 0, width, height);
      resized = target.toBuffer("image/png");
    } catch {
      return {
        status: "unusable",
        note: `This picture is ${sizes}, and it could not be made smaller. Capture a smaller region instead.`,
      };
    }

    const tall =
      ratio > readableRatio
        ? ` This is a very long page — about ${Math.round(ratio)} times taller than it is wide — so its text may be unreadable at this size. Capture a section at a time if you need to read it.`
        : "";
    return {
      status: "resized",
      image: { mediaType: "image/png", data: resized.toString("base64") },
      note: `This picture was ${sizes}. It was scaled to ${describe(width, height)} to be sent.${tall}`,
    };
  }
}
