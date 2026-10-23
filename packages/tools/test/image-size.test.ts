import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { imageSize } from "../src/image-size.js";

/**
 * Real files rather than hand-written headers: the point of reading a size out
 * of a header is that it agrees with what an encoder actually wrote.
 */
const require = createRequire(import.meta.url);
const { createCanvas } = require("@napi-rs/canvas") as {
  createCanvas(
    width: number,
    height: number,
  ): {
    getContext(kind: "2d"): {
      fillStyle: string;
      fillRect(...args: number[]): void;
    };
    toBuffer(mime: string, quality?: number): Buffer;
  };
};

function drawn(width: number, height: number, mime: string): Buffer {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#3366aa";
  context.fillRect(0, 0, width, height);
  return canvas.toBuffer(mime, 80);
}

describe("how large a picture is", () => {
  it("reads the size an encoder wrote, for each kind we accept", () => {
    expect(imageSize(drawn(321, 123, "image/png"))).toEqual({
      width: 321,
      height: 123,
    });
    expect(imageSize(drawn(640, 400, "image/jpeg"))).toEqual({
      width: 640,
      height: 400,
    });
    expect(imageSize(drawn(200, 50, "image/webp"))).toEqual({
      width: 200,
      height: 50,
    });
  });

  it("reads a GIF and a bitmap from their own headers", () => {
    const gif = Buffer.from(
      "R0lGODdhCgAFAIAAAAAAAP///ywAAAAACgAFAAACB4SPqcvtDwUAOw==",
      "base64",
    );
    expect(imageSize(gif)).toEqual({ width: 10, height: 5 });

    const bitmap = Buffer.alloc(54);
    bitmap.write("BM", 0, "latin1");
    bitmap.writeUInt32LE(40, 14);
    bitmap.writeInt32LE(12, 18);
    // Height is signed: a negative one means the rows are stored top-down.
    bitmap.writeInt32LE(-8, 22);
    expect(imageSize(bitmap)).toEqual({ width: 12, height: 8 });
  });

  it("says nothing rather than guessing at a file it cannot measure", () => {
    expect(imageSize(Buffer.from("not an image at all"))).toBeUndefined();
    // A truncated PNG: the signature is there and the size is not.
    expect(
      imageSize(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBeUndefined();
  });
});
