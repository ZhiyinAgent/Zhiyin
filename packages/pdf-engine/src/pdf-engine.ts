/**
 * Loading pdf.js under Node, and the options every document is opened with.
 *
 * `pdfjs-dist` publishes a browser-first ESM build and a `legacy` build for
 * Node. Both it and the canvas are required on first use, resolved from this
 * package: a reader and a native canvas are large to pay for on a launch that
 * opens no PDF.
 */

import { readFileSync } from "node:fs";
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
export function loadCanvas(
  options: {
    /** A font for the characters the fonts a page names cannot draw. */
    readonly fallbackFont?: string;
  } = {},
): CanvasModule {
  const require = createRequire(import.meta.url);
  const canvas = require("@napi-rs/canvas") as CanvasModule &
    Record<string, unknown>;
  for (const name of ["Path2D", "DOMMatrix", "ImageData"])
    if (
      canvas[name] &&
      globalThis[name as keyof typeof globalThis] !== canvas[name]
    )
      (globalThis as Record<string, unknown>)[name] = canvas[name];
  const fonts = canvas["GlobalFonts"] as GlobalFonts;
  if (!familiesNamed) {
    for (const [generic, family] of genericFamilies)
      fonts.setAlias(family, generic);
    familiesNamed = true;
  }
  if (options.fallbackFont && !fallbackInstalled)
    fallbackInstalled = installFallbackFont(
      canvas,
      fonts,
      options.fallbackFont,
    );
  return canvas;
}

type GlobalFonts = {
  register(font: Buffer, alias?: string): unknown;
  setAlias(family: string, alias: string): boolean;
};

/**
 * The fonts the generic families stand for: those every Windows has. The
 * canvas resolves no generic family itself, and draws a family it cannot find
 * in whichever installed font it lists first. pdf.js names a generic family
 * after any font a document names without embedding, so without these such
 * text is drawn in a font that differs from one machine to the next.
 */
const genericFamilies = [
  ["sans-serif", "Arial"],
  ["serif", "Times New Roman"],
  ["monospace", "Courier New"],
] as const;
let familiesNamed = false;

/** The family the fallback font is registered under. */
const fallbackFamily = "Zhiyin Fallback";
let fallbackInstalled = false;

/** The fallback font's family, once it is installed. */
export function fallbackFontFamily(): string | undefined {
  return fallbackInstalled ? fallbackFamily : undefined;
}

/**
 * Text in a font a document names without embedding, and pdf.js does not
 * ship, is drawn by the canvas from a font of that name on the machine, else
 * from a generic family; neither need have Chinese, Japanese or Korean glyphs.
 * The fallback font is named last in every font the canvas is given, and the
 * canvas picks a font per character along that list, so the fallback draws
 * only the characters the fonts before it lack and Latin text keeps its font.
 * Setting the font on the class covers every canvas, including those pdf.js
 * makes for itself, since it loads the same canvas module.
 *
 * The file is read through Node, which reads inside the packed app archive,
 * and registered from memory. One that cannot be read leaves the fonts as
 * they were.
 */
function installFallbackFont(
  canvas: CanvasModule,
  fonts: GlobalFonts,
  path: string,
): boolean {
  let registered: unknown;
  try {
    registered = fonts.register(readFileSync(path), fallbackFamily);
  } catch {
    return false;
  }
  if (!registered) return false;
  const context = Object.getPrototypeOf(
    canvas.createCanvas(1, 1).getContext("2d"),
  ) as object;
  const font = Object.getOwnPropertyDescriptor(context, "font");
  if (!font?.set) return false;
  const set = font.set;
  Object.defineProperty(context, "font", {
    ...font,
    set(this: unknown, value: unknown) {
      set.call(
        this,
        typeof value === "string" ? `${value}, "${fallbackFamily}"` : value,
      );
    },
  });
  return true;
}

/**
 * The same options whether the pages are read or drawn. Nothing here may reach
 * the network or the machine's fonts for a file the person did not ask for.
 * Three folders that ship with the reader are named: the standard fonts, so a
 * page drawn without embedded fonts still has glyphs to draw; the decoders for
 * fax, JBIG2 and JPEG 2000 images, without which a scanned page draws blank;
 * and the character maps a Chinese, Japanese or Korean font refers to by name,
 * without which its text is neither drawn nor read. pdf.js reads each from the
 * disk, and wants each path to end in "/". The version in use has no way to
 * evaluate what a document contains, so there is nothing to switch off
 * (CVE-2024-4367); a test holds that.
 */
export function pdfDocumentOptions(bytes: Uint8Array): Record<string, unknown> {
  const require = createRequire(import.meta.url);
  const folder = (name: string) =>
    require
      .resolve("pdfjs-dist/package.json")
      .replace(/package\.json$/, `${name}/`);
  return {
    data: bytes,
    useSystemFonts: false,
    disableFontFace: true,
    maxImageSize: maximumImagePixels,
    standardFontDataUrl: folder("standard_fonts"),
    wasmUrl: folder("wasm"),
    cMapUrl: folder("cmaps"),
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
