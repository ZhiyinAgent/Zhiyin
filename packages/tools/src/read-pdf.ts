/**
 * Reads the words out of a PDF.
 *
 * A PDF is the one binary a person routinely means when they say "read this
 * file", so it is read here rather than refused with the rest. What comes back
 * is the text, page by page, because a page number is how anyone refers to a
 * part of a document — an answer that quotes page 14 can be checked, and one
 * that quotes an unlabelled paragraph cannot.
 *
 * A long document is read in part, never silently: the answer says how many
 * pages there are, which of them it read, and how to ask for the rest. A
 * report that stops after page 9 and does not say so reads exactly like a
 * report that ends at page 9.
 *
 * Only the text. A PDF whose content is scanned images has no text to give,
 * and says so rather than returning empty pages that look like empty pages.
 */

import { createRequire } from "node:module";
import { maximumImagePixels } from "./image-size.js";

/** How much text one read carries, before the file's own bound applies. */
const maximumPdfCharacters = 60_000;

export type PdfRange = { readonly first: number; readonly last: number };
/** Pages, as ranges in page order that neither touch nor overlap. */
export type PdfPages = readonly PdfRange[];

export type PdfReadResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly pages: number;
      readonly read: PdfPages;
      readonly complete: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * `pdfjs-dist` publishes a browser-first ESM build and a `legacy` build for
 * Node. Resolved through `createRequire` so the path is found from this
 * package rather than from whoever imported it, and loaded on first use: a
 * PDF reader is a large dependency to pay for on every launch that reads none.
 */
type PdfjsModule = {
  getDocument(options: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
};
type PdfPage = {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
  getViewport(options: { scale: number }): {
    readonly width: number;
    readonly height: number;
  };
  render(options: Record<string, unknown>): { promise: Promise<void> };
};
type PdfDocument = {
  readonly numPages: number;
  getPage(page: number): Promise<PdfPage>;
  cleanup(): Promise<void>;
};

type CanvasContext = {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
};
type CanvasModule = {
  createCanvas(
    width: number,
    height: number,
  ): {
    readonly width: number;
    readonly height: number;
    getContext(kind: "2d"): CanvasContext;
    toBuffer(mime: "image/jpeg", quality?: number): Buffer;
  };
};

/**
 * How many pages one answer draws, and how large each may be.
 *
 * A page drawn at readable resolution is worth roughly a thousand words of
 * context, and every one is re-sent with each later request in the turn. Two is
 * a spread; more is a bill nobody agreed to. The rest are asked for by page
 * range, which is how anyone reads a long document anyway.
 */
const maximumRenderedPages = 2;
const maximumRenderedBytes = 1_200_000;
/** Readable without being a poster: about 150 DPI for an A4 or Letter page. */
const renderScales = [2, 1.5, 1] as const;

let pdfjs: Promise<PdfjsModule> | undefined;

/**
 * Drawing needs a canvas, which Node does not have, and `pdf.js` reaches for
 * `Path2D`, `DOMMatrix` and `ImageData` as globals while it draws.
 *
 * They must be this canvas implementation's own, and they are installed even
 * when something already defined them — `pdf.js` polyfills all three itself as
 * it loads, and a shape built by one implementation is rejected by the other
 * with `Value is none of these types`, mid-glyph, on every page that has text.
 */
function loadCanvas(): CanvasModule {
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

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjs ??= (async () => {
    const require = createRequire(import.meta.url);
    // `require` rather than `import()`: packaged, this module lives inside an
    // asar archive, whose path Electron resolves for `require` and not for a
    // file URL. Node 22 loads an ES module through `require` (measured here on
    // 22.14), so the same call works unpackaged.
    return require("pdfjs-dist/legacy/build/pdf.mjs") as PdfjsModule;
  })().catch((cause: unknown) => {
    pdfjs = undefined;
    throw cause;
  });
  return pdfjs;
}

/**
 * `3`, `2-5`, or a list of both such as `2-5,8`: read in page order, each page
 * once. Anything else is not a page list and is not guessed at.
 */
export function parsePages(value: unknown): PdfPages | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return "invalid";
  const ranges: PdfRange[] = [];
  for (const part of value.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) return "invalid";
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (first < 1 || last < first) return "invalid";
    ranges.push({ first, last });
  }
  return merged(ranges);
}

function merged(ranges: readonly PdfRange[]): PdfRange[] {
  const out: PdfRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.first - b.first)) {
    const previous = out.at(-1);
    if (previous && range.first <= previous.last + 1)
      out[out.length - 1] = {
        first: previous.first,
        last: Math.max(previous.last, range.last),
      };
    else out.push(range);
  }
  return out;
}

/** Pages as a person, or the `pages` argument, would write them. */
export function describePages(pages: PdfPages): string {
  return pages
    .map(({ first, last }) =>
      first === last ? `${first}` : `${first}-${last}`,
    )
    .join(", ");
}

const asPages = (numbers: readonly number[]): PdfRange[] =>
  merged(numbers.map((page) => ({ first: page, last: page })));

/** The asked-for pages the document has, in order, and those it has not. */
function pagesIn(requested: PdfPages | undefined, total: number) {
  const asked = requested ?? [{ first: 1, last: total }];
  const order = asked
    .filter((range) => range.first <= total)
    .flatMap(({ first, last }) =>
      Array.from(
        { length: Math.min(last, total) - first + 1 },
        (_, index) => first + index,
      ),
    );
  const missing = asked
    .filter((range) => range.last > total)
    .map((range) => ({
      first: Math.max(range.first, total + 1),
      last: range.last,
    }));
  return { order, missing };
}

const pageCount = (total: number) =>
  `${total} ${total === 1 ? "page" : "pages"}`;

function noSuchPage(total: number, requested: PdfPages): string {
  return `This PDF has ${pageCount(total)}, so there is no page ${requested[0]?.first ?? total + 1}.`;
}

/** Said of the asked-for pages past the end, so none goes missing silently. */
export function missingPages(total: number, missing: PdfPages): string {
  if (!missing.length) return "";
  const one = missing.length === 1 && missing[0]?.first === missing[0]?.last;
  return `This PDF has ${pageCount(total)}, so ${one ? "page" : "pages"} ${describePages(missing)} ${one ? "was" : "were"} not read.`;
}

function textOfPage(items: readonly unknown[]): string {
  return items
    .map((item) =>
      item && typeof item === "object" && "str" in item
        ? String((item as { str: unknown }).str)
        : "",
    )
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The same options whether the pages are read or drawn. Nothing here may reach
 * the network for a file the person did not ask for, and nothing evaluates what
 * the document contains. The standard fonts ship with the reader and are named
 * so that a page drawn without embedded fonts still has glyphs to draw.
 */
function documentOptions(bytes: Buffer): Record<string, unknown> {
  const require = createRequire(import.meta.url);
  return {
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: require
      .resolve("pdfjs-dist/package.json")
      .replace(/package\.json$/, "standard_fonts/"),
  };
}

export async function readPdfText(
  bytes: Buffer,
  requested: PdfPages | undefined,
  signal?: AbortSignal,
): Promise<PdfReadResult> {
  let pdf: PdfjsModule;
  try {
    pdf = await loadPdfjs();
  } catch {
    return {
      ok: false,
      reason: "The PDF reader could not be started, so this PDF was not read.",
    };
  }
  const task = pdf.getDocument(documentOptions(bytes));
  let document: PdfDocument;
  try {
    document = await task.promise;
  } catch {
    await task.destroy().catch(() => undefined);
    return {
      ok: false,
      reason:
        "This PDF could not be opened. It may be damaged, or protected by a password.",
    };
  }

  try {
    const total = document.numPages;
    const { order, missing } = pagesIn(requested, total);
    if (requested && !order.length)
      return { ok: false, reason: noSuchPage(total, requested) };
    const parts: string[] = [];
    const read: number[] = [];
    let length = 0;
    for (const page of order) {
      if (signal?.aborted)
        return { ok: false, reason: "Reading the PDF was cancelled." };
      const text = textOfPage(
        (await (await document.getPage(page)).getTextContent()).items,
      );
      const block = `--- Page ${page} ---\n${text || "(no text on this page)"}`;
      // Stop before going over rather than after: a page half-included is a
      // page whose second half silently does not exist.
      if (length + block.length > maximumPdfCharacters && parts.length) break;
      parts.push(block);
      length += block.length + 2;
      read.push(page);
    }
    const left = order.slice(read.length);
    const complete = left.length === 0;
    const notice = complete
      ? ""
      : `\n\n… Stopped after page ${read.at(-1)} of ${total}. Read further with pages: "${describePages(asPages(left.slice(0, 10)))}". …`;
    const past = missingPages(total, missing);
    const body = parts.join("\n\n");
    if (!body.replace(/--- Page \d+ ---|\(no text on this page\)/g, "").trim())
      return {
        ok: false,
        reason:
          'This PDF has no text in it — it is probably scanned. Read it with as: "image" to look at the pages.',
      };
    return {
      ok: true,
      text: `${body}${notice}${past ? `\n\n${past}` : ""}`,
      pages: total,
      read: asPages(read),
      complete,
    };
  } catch {
    return { ok: false, reason: "This PDF could not be read to the end." };
  } finally {
    await document.cleanup().catch(() => undefined);
    await task.destroy().catch(() => undefined);
  }
}

export type PdfRenderResult =
  | {
      readonly ok: true;
      readonly images: readonly { mediaType: string; data: string }[];
      readonly pages: number;
      readonly read: PdfPages;
      /** Asked-for pages that exist and were not drawn this time. */
      readonly rest: PdfPages;
      readonly missing: PdfPages;
      readonly complete: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Draws pages of a PDF, for a document whose text is not text: a scan, a
 * diagram, a page whose layout is the point. What comes back is one picture per
 * page, on the picture channel, never encoded into the answer.
 */
export async function renderPdfPages(
  bytes: Buffer,
  requested: PdfPages | undefined,
  signal?: AbortSignal,
): Promise<PdfRenderResult> {
  let pdf: PdfjsModule;
  let canvasModule: CanvasModule;
  try {
    // The canvas first: `pdf.js` installs its own shape classes as it loads,
    // and the ones that draw have to be the ones the canvas will accept.
    canvasModule = loadCanvas();
    pdf = await loadPdfjs();
  } catch {
    return {
      ok: false,
      reason: "The PDF reader could not be started, so no page could be drawn.",
    };
  }
  const task = pdf.getDocument(documentOptions(bytes));
  let document: PdfDocument;
  try {
    document = await task.promise;
  } catch {
    await task.destroy().catch(() => undefined);
    return {
      ok: false,
      reason:
        "This PDF could not be opened. It may be damaged, or protected by a password.",
    };
  }

  try {
    const total = document.numPages;
    const { order, missing } = pagesIn(requested, total);
    if (requested && !order.length)
      return { ok: false, reason: noSuchPage(total, requested) };
    const drawing = order.slice(0, maximumRenderedPages);
    const images: { mediaType: string; data: string }[] = [];
    for (const number of drawing) {
      if (signal?.aborted)
        return { ok: false, reason: "Drawing the PDF was cancelled." };
      const page = await document.getPage(number);
      let drawn: Buffer | undefined;
      // A page can be any size a document says it is, and a poster drawn at
      // full scale goes past what a model will accept on its own. The largest
      // scale is whatever keeps both sides inside that.
      const full = page.getViewport({ scale: 1 });
      const ceiling = maximumImagePixels / Math.max(full.width, full.height, 1);
      // Down one step at a time rather than straight to the smallest: the point
      // of drawing a page is that its words can be read afterwards.
      for (const scale of renderScales) {
        const viewport = page.getViewport({ scale: Math.min(scale, ceiling) });
        const canvas = canvasModule.createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        const context = canvas.getContext("2d");
        // A PDF page carries no background of its own; drawn without this one
        // it arrives as white text on black.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        drawn = canvas.toBuffer("image/jpeg", 80);
        if (drawn.length <= maximumRenderedBytes) break;
      }
      if (!drawn || drawn.length > maximumRenderedBytes)
        return {
          ok: false,
          reason: `Page ${number} could not be drawn small enough to send.`,
        };
      images.push({ mediaType: "image/jpeg", data: drawn.toString("base64") });
    }
    return {
      ok: true,
      images,
      pages: total,
      read: asPages(drawing),
      rest: asPages(order.slice(drawing.length)),
      missing,
      complete: drawing.length === order.length,
    };
  } catch {
    return { ok: false, reason: "This PDF could not be drawn." };
  } finally {
    await document.cleanup().catch(() => undefined);
    await task.destroy().catch(() => undefined);
  }
}
