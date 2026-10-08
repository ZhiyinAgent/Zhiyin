/**
 * Loading pdf.js under Node, and the options every document is opened with.
 *
 * `pdfjs-dist` publishes a browser-first ESM build and a `legacy` build for
 * Node. Both it and the canvas are required on first use, resolved from this
 * package: a reader and a native canvas are large to pay for on a launch that
 * opens no PDF.
 */

import { createRequire } from "node:module";

export type PdfViewport = { readonly width: number; readonly height: number };

export type PdfPage = {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
  getViewport(options: { scale: number }): PdfViewport;
  render(options: Record<string, unknown>): { promise: Promise<void> };
  cleanup(): void;
};

export type PdfDocument = {
  readonly numPages: number;
  getPage(page: number): Promise<PdfPage>;
  cleanup(): Promise<void>;
};

export type PdfLoadingTask = {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
};

export type Pdfjs = {
  getDocument(options: Record<string, unknown>): PdfLoadingTask;
};

export type CanvasContext = {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(
    image: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
};

export type Canvas = {
  readonly width: number;
  readonly height: number;
  getContext(kind: "2d"): CanvasContext;
  toBuffer(mime: "image/jpeg", quality?: number): Buffer;
  toBuffer(mime: "image/png"): Buffer;
};

export type CanvasModule = {
  createCanvas(width: number, height: number): Canvas;
  loadImage(
    source: Buffer,
  ): Promise<{ readonly width: number; readonly height: number }>;
};

/**
 * The largest image, in pixels, pdf.js decodes on a page. An image is decoded
 * into memory whole before it is scaled to the page, so one declared at
 * 50,000 pixels square asks for ten gigabytes whatever size the page is drawn
 * at. 64 million is a full A4 page scanned at 600 DPI with room to spare; past
 * it the image is left out and the rest of the page is still drawn.
 */
const maximumImagePixels = 64_000_000;

let pdfjs: Promise<Pdfjs> | undefined;

export function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= (async () => {
    const require = createRequire(import.meta.url);
    // `require` rather than `import()`: packaged, this module lives inside an
    // asar archive, whose path Electron resolves for `require` and not for a
    // file URL. Node 22 loads an ES module through `require` (measured on
    // 22.14), so the same call works unpackaged.
    return require("pdfjs-dist/legacy/build/pdf.mjs") as Pdfjs;
  })().catch((cause: unknown) => {
    pdfjs = undefined;
    throw cause;
  });
  return pdfjs;
}

/**
 * Drawing needs a canvas, which Node does not have, and `pdf.js` reaches for
 * `Path2D`, `DOMMatrix` and `ImageData` as globals while it draws.
 *
 * They must be this canvas implementation's own, and they are installed even
 * when something already defined them — `pdf.js` polyfills all three itself as
 * it loads, and a shape built by one implementation is rejected by the other
 * with `Value is none of these types`, mid-glyph, on every page that has text.
 * So the canvas is loaded before pdf.js draws anything.
 */
export function loadCanvas(): CanvasModule {
  const require = createRequire(import.meta.url);
  const canvas = require("@napi-rs/canvas") as CanvasModule &
    Record<string, unknown>;
  for (const name of ["Path2D", "DOMMatrix", "ImageData"])
    if (
      canvas[name] &&
      globalThis[name as keyof typeof globalThis] !== canvas[name]
    )
      (globalThis as Record<string, unknown>)[name] = canvas[name];
  return canvas;
}

/**
 * The same options whether the pages are read or drawn. Nothing here may reach
 * the network or the machine's fonts for a file the person did not ask for.
 * The standard fonts ship with the reader and are named so that a page drawn
 * without embedded fonts still has glyphs to draw. The version in use has no
 * way to evaluate what a document contains, so there is nothing to switch off
 * (CVE-2024-4367); a test holds that.
 */
export function pdfDocumentOptions(bytes: Uint8Array): Record<string, unknown> {
  const require = createRequire(import.meta.url);
  return {
    data: bytes,
    useSystemFonts: false,
    disableFontFace: true,
    maxImageSize: maximumImagePixels,
    standardFontDataUrl: require
      .resolve("pdfjs-dist/package.json")
      .replace(/package\.json$/, "standard_fonts/"),
  };
}

/**
 * The words of one item of a page's text, ending in a line break where the
 * page ends a line there. pdf.js marks the end of a line rather than putting a
 * space in it, so text joined without the break runs the last word of one line
 * into the first of the next.
 */
export function textOfItem(item: unknown): string {
  if (!item || typeof item !== "object" || !("str" in item)) return "";
  const ended = "hasEOL" in item && item.hasEOL === true;
  return String(item.str) + (ended ? "\n" : "");
}
