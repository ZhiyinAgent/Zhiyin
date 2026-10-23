import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCanvas, pdfDocumentOptions } from "../src/index.js";

const require = createRequire(import.meta.url);
const build = join(
  dirname(require.resolve("pdfjs-dist/package.json")),
  "legacy",
  "build",
);

describe("the PDF engine", () => {
  // CVE-2024-4367: a crafted font made pdf.js run text from the document as
  // code, through `new Function`, where evaluation was allowed. The version in
  // use has no such path at all, so there is no option to turn it off; this
  // fails if an upgrade brings one back. The folder of image decoders pdf.js
  // is pointed at also holds QuickJS, a script engine that only pdf.js's
  // separate scripting sandbox loads; this fails if the reader starts to.
  it("carries no way to run text from a document as code", async () => {
    for (const file of ["pdf.mjs", "pdf.worker.mjs"]) {
      const source = await readFile(join(build, file), "utf8");
      expect(source, file).not.toMatch(/new Function\s*\(/);
      expect(source, file).not.toMatch(/(?<![\w.$])eval\s*\(/);
      expect(source, file).not.toMatch(/quickjs/i);
    }
  });

  it("opens a document without the network, system fonts or font faces, and with a bound on images", () => {
    const options = pdfDocumentOptions(new Uint8Array([1, 2, 3]));
    expect(options).toMatchObject({
      useSystemFonts: false,
      disableFontFace: true,
      maxImageSize: expect.any(Number),
    });
    expect(String(options["standardFontDataUrl"])).toMatch(
      /standard_fonts[\\/]$/,
    );
  });
  // pdf.js names a generic family after every font a document names without
  // embedding; the canvas resolves none by itself.
  it.each([
    ["sans-serif", "Arial"],
    ["serif", "Times New Roman"],
    ["monospace", "Courier New"],
  ])("draws %s in %s, which every Windows has", (generic, family) => {
    const canvas = loadCanvas();
    const drawnIn = (font: string) => {
      const picture = canvas.createCanvas(400, 50);
      const context = picture.getContext("2d") as unknown as {
        fillStyle: string;
        font: string;
        fillRect(x: number, y: number, width: number, height: number): void;
        fillText(text: string, x: number, y: number): void;
      };
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 400, 50);
      context.fillStyle = "#000000";
      context.font = font;
      context.fillText("Quarterly report Wg", 5, 35);
      return picture.toBuffer("image/png");
    };
    expect(drawnIn(`24px ${generic}`).equals(drawnIn(`24px "${family}"`))).toBe(
      true,
    );
  });
});
