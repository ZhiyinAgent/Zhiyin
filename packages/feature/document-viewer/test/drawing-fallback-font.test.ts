import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCanvas } from "@zhiyin/pdf-engine";
import {
  serveDrawing,
  type DrawingReply,
  type DrawingRequest,
} from "../src/index.js";
import { chinesePdf, pdf } from "./pdf-builder.js";

/**
 * A font whose only glyphs are 中, 文 and the Latin letters, each a filled
 * square: drawn with it, characters are solid squares, where a font without
 * them draws hollow boxes and a font of their own draws letters.
 */
const solidFont = fileURLToPath(
  new URL("./fixtures/solid-cjk.ttf", import.meta.url),
);

type Box = { x: number; y: number; width: number; height: number };
// Drawn 612 pixels wide, a page 612 points wide has one pixel per point,
// counted from its top. The line of text sits on the line 100 points from the
// top, in 24-point type.
const text: Box = { x: 72, y: 70, width: 228, height: 34 };

/** The page drawn by a drawing service given the font, as dark pixels per box. */
async function drawn(
  bytes: Buffer,
  format: "pdf" | "svg" = "pdf",
  width = 612,
) {
  const waiting = new Map<number, (reply: DrawingReply) => void>();
  let deliver: ((request: DrawingRequest) => void) | undefined;
  serveDrawing(
    {
      receive: (handler) => {
        deliver = handler;
      },
      send: (reply) => waiting.get(reply.id)?.(structuredClone(reply)),
    },
    { fallbackFont: solidFont },
  );
  let next = 0;
  const ask = (request: Record<string, unknown>): Promise<DrawingReply> =>
    new Promise((resolve) => {
      const id = ++next;
      waiting.set(id, resolve);
      deliver?.({ ...request, id } as DrawingRequest);
    });
  await ask({
    kind: "open",
    revision: "r1",
    format,
    bytes: new Uint8Array(bytes),
  });
  const reply = await ask({
    kind: "draw",
    revision: "r1",
    page: 1,
    width,
  });
  if (!reply.ok || reply.kind !== "drawn") throw new Error("not drawn");
  const picture = await loadCanvas().loadImage(Buffer.from(reply.png));
  const canvas = loadCanvas().createCanvas(picture.width, picture.height);
  const context = canvas.getContext("2d");
  context.drawImage(picture, 0, 0, picture.width, picture.height);
  const pixels = (
    context as unknown as {
      getImageData(x: number, y: number, w: number, h: number): ImageData;
    }
  ).getImageData(0, 0, picture.width, picture.height);
  return ({ x, y, width, height }: Box): number => {
    let count = 0;
    for (let row = y; row < y + height; row++)
      for (let column = x; column < x + width; column++) {
        const at = (row * pixels.width + column) * 4;
        const [red, green, blue] = pixels.data.subarray(at, at + 3);
        if ((red! + green! + blue!) / 3 < 128) count++;
      }
    return count;
  };
}

describe("the drawing service, given a font for characters a document's fonts lack", () => {
  it("draws Chinese text in a font the file does not embed with that font's glyphs", async () => {
    const dark = await drawn(chinesePdf());
    // Two squares about 22 pixels on a side are near a thousand dark pixels;
    // the hollow boxes a font without the characters draws are too faint to
    // count.
    expect(dark(text)).toBeGreaterThan(700);
  });

  it.each([
    ["written as characters", "中文"],
    ["written as references", "&#20013;&#x6587;"],
  ])(
    "draws Chinese text in an SVG, %s, with the given font, and Latin text beside it in its own",
    async (_, chinese) => {
      const dark = await drawn(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60"><rect width="400" height="60" fill="white"/><text x="10" y="40" font-size="30" font-family="Arial">AB <tspan fill="black">${chinese}</tspan></text></svg>`,
        ),
        "svg",
        400,
      );

      // As solid squares, two characters of 30-pixel type are about 1,500
      // dark pixels; a font without them draws next to nothing.
      expect(dark({ x: 56, y: 10, width: 90, height: 40 })).toBeGreaterThan(
        1_000,
      );
      // "AB" in Arial is a few hundred; as squares it would be about 1,500.
      expect(dark({ x: 8, y: 10, width: 44, height: 40 })).toBeLessThan(900);
    },
  );

  it("draws Latin text in a font the file does not embed in a font of the machine's, not the given one", async () => {
    const dark = await drawn(
      pdf({
        lines: ["Quarterly report"],
        font: "<< /Type /Font /Subtype /TrueType /BaseFont /ZhiyinNoSuchFont /FirstChar 32 /LastChar 126 /Encoding /WinAnsiEncoding /FontDescriptor 1000 0 R >>",
        objects: [
          "<< /Type /FontDescriptor /FontName /ZhiyinNoSuchFont /Flags 32 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
        ],
      }),
    );
    // In Arial, the line is about 800 dark pixels; as squares, about 3,000.
    expect(dark(text)).toBeGreaterThan(200);
    expect(dark(text)).toBeLessThan(1_500);
  });
});
