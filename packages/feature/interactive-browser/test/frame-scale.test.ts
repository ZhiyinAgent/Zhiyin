import { describe, expect, it } from "vitest";
import { drawnAtScale } from "../src/frame-scale.js";

/** The start of a JPEG of the given size: what a frame's size is read from. */
function jpeg(width: number, height: number): string {
  const application = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const frame = Buffer.alloc(19);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(17, 2);
  frame.writeUInt8(8, 4);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    application,
    frame,
  ]).toString("base64");
}

describe("a streamed frame's scale", () => {
  it("takes a frame drawn at the page's size times the screen's density", () => {
    expect(drawnAtScale(jpeg(780, 1688), { width: 390, height: 844 }, 2)).toBe(
      true,
    );
    expect(drawnAtScale(jpeg(800, 600), { width: 800, height: 600 }, 1)).toBe(
      true,
    );
  });

  it("refuses a frame still drawn at the size before a resize", () => {
    expect(drawnAtScale(jpeg(555, 1200), { width: 390, height: 844 }, 2)).toBe(
      false,
    );
  });

  it("allows a pixel of rounding at a density that is not whole", () => {
    expect(
      drawnAtScale(jpeg(488, 1055), { width: 390, height: 844 }, 1.25),
    ).toBe(true);
    expect(
      drawnAtScale(jpeg(470, 1055), { width: 390, height: 844 }, 1.25),
    ).toBe(false);
  });

  it("takes a frame drawn to fit the panel it is shown in, and refuses one drawn before a resize", () => {
    const panel = { width: 900, height: 560 };
    // A 1280 by 800 page at density 1.5, fitted into 900 by 560.
    expect(
      drawnAtScale(jpeg(896, 560), { width: 1280, height: 800 }, 1.5, panel),
    ).toBe(true);
    expect(
      drawnAtScale(jpeg(560, 560), { width: 1280, height: 800 }, 1.5, panel),
    ).toBe(false);
    // A page smaller than the panel is drawn at its own size.
    expect(
      drawnAtScale(jpeg(600, 450), { width: 400, height: 300 }, 1.5, panel),
    ).toBe(true);
  });

  it("refuses a frame whose size cannot be read", () => {
    expect(
      drawnAtScale(
        Buffer.from("not a picture").toString("base64"),
        { width: 390, height: 844 },
        2,
      ),
    ).toBe(false);
  });
});
