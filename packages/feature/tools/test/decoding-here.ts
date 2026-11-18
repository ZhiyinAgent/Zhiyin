/**
 * Decoders that open PDFs and pictures in this process, with its canvas and
 * pdf.js, for tests. The app hands the tools ones that decode in a contained
 * process (ADR 0019); the tools themselves hold none.
 */

import {
  loadCanvas,
  loadPdfjs,
  pdfDocumentOptions,
  textOfItem,
  type CanvasModule,
  type Pdfjs,
  type PdfDocument,
} from "@zhiyin/pdf-engine";
import type { Pixels } from "@zhiyin/picture-comparison";
import {
  WorkspaceTools,
  type PdfPagesSource,
  type PixelSource,
  type ShrinkPicture,
  type WorkspaceToolsOptions,
} from "../src/index.js";

/** The tools, given these decoders unless the options name others. */
export class ToolsDecodingHere extends WorkspaceTools {
  constructor(workspaceRoot?: string, options: WorkspaceToolsOptions = {}) {
    super(workspaceRoot, {
      pdfPages: pdfPagesHere,
      pixels: pixelsHere,
      ...options,
    });
  }
}

const pdfPagesHere: PdfPagesSource = {
  async open(bytes, use) {
    let pdf: Pdfjs;
    let canvasModule: CanvasModule | undefined;
    try {
      // The canvas first: `pdf.js` installs its own shape classes as it
      // loads, and the ones that draw have to be the ones the canvas accepts.
      if (use === "pictures") canvasModule = loadCanvas();
      pdf = await loadPdfjs();
    } catch {
      return { ok: false, failure: "unstartable" };
    }
    const task = pdf.getDocument(pdfDocumentOptions(new Uint8Array(bytes)));
    let document: PdfDocument;
    const pages: { width: number; height: number }[] = [];
    try {
      document = await task.promise;
      for (let number = 1; number <= document.numPages; number += 1) {
        const { width, height } = (await document.getPage(number)).getViewport({
          scale: 1,
        });
        pages.push({ width, height });
      }
    } catch {
      await task.destroy().catch(() => undefined);
      return { ok: false, failure: "unopenable" };
    }
    return {
      ok: true,
      pages,
      text: async (number) => {
        try {
          const { items } = await (
            await document.getPage(number)
          ).getTextContent();
          return items.map(textOfItem);
        } catch {
          return undefined;
        }
      },
      picture: async (number, scale, quality) => {
        if (!canvasModule) return undefined;
        try {
          const page = await document.getPage(number);
          const viewport = page.getViewport({ scale });
          const canvas = canvasModule.createCanvas(
            Math.ceil(viewport.width),
            Math.ceil(viewport.height),
          );
          const context = canvas.getContext("2d");
          // A PDF page carries no background of its own; drawn without this
          // one it arrives as white text on black.
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: context, viewport, canvas })
            .promise;
          return canvas.toBuffer("image/jpeg", quality);
        } catch {
          return undefined;
        }
      },
      close: () => {
        void document
          .cleanup()
          .catch(() => undefined)
          .then(() => task.destroy())
          .catch(() => undefined);
      },
    };
  },
};

/** A picture is drawn no larger than this on its long side, as a page is. */
const maximumPictureSide = 2000;
/** A PDF point is 1/72 inch; a CSS pixel is 1/96. */
const cssPixelsPerPoint = 96 / 72;

function bounded(width: number, height: number) {
  const scale = Math.min(1, maximumPictureSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function pixelsOf(
  canvas: ReturnType<CanvasModule["createCanvas"]>,
  width: number,
  height: number,
): Pixels {
  const { data } = canvas.getContext("2d").getImageData(0, 0, width, height);
  return {
    rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width,
    height,
  };
}

const pixelsHere: PixelSource = {
  async open(bytes, format) {
    let canvas: CanvasModule;
    try {
      canvas = loadCanvas();
    } catch {
      return { ok: false, failure: "unstartable" };
    }
    if (format !== "pdf") {
      let image: { readonly width: number; readonly height: number };
      try {
        image = await canvas.loadImage(Buffer.from(bytes));
      } catch {
        return { ok: false, failure: "unopenable" };
      }
      if (!image.width || !image.height)
        return { ok: false, failure: "unopenable" };
      const size = bounded(image.width, image.height);
      return {
        ok: true,
        pages: [size],
        draw: async (page, asked) => {
          if (page !== 1) return undefined;
          const width = Math.max(1, Math.round(Math.min(asked, size.width)));
          const height = Math.max(
            1,
            Math.round((size.height * width) / size.width),
          );
          const target = canvas.createCanvas(width, height);
          const context = target.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          return pixelsOf(target, width, height);
        },
        close: () => undefined,
      };
    }
    const task = (await loadPdfjs()).getDocument(pdfDocumentOptions(bytes));
    let document: PdfDocument;
    const pages: { width: number; height: number }[] = [];
    try {
      document = await task.promise;
      for (let number = 1; number <= document.numPages; number += 1) {
        const { width, height } = (await document.getPage(number)).getViewport({
          scale: cssPixelsPerPoint,
        });
        pages.push({ width: Math.round(width), height: Math.round(height) });
      }
    } catch {
      await task.destroy().catch(() => undefined);
      return { ok: false, failure: "unopenable" };
    }
    return {
      ok: true,
      pages,
      draw: async (number, asked) => {
        const size = pages[number - 1];
        if (!size || !Number.isInteger(number)) return undefined;
        const width = Math.max(1, Math.round(Math.min(asked, size.width * 2)));
        const scale = width / size.width;
        const height = Math.max(1, Math.round(size.height * scale));
        try {
          const target = canvas.createCanvas(width, height);
          const context = target.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          const page = await document.getPage(number);
          const viewport = page.getViewport({
            scale: cssPixelsPerPoint * scale,
          });
          await page.render({
            canvasContext: context,
            viewport,
            canvas: target,
          }).promise;
          page.cleanup();
          return pixelsOf(target, width, height);
        } catch {
          return undefined;
        }
      },
      close: () => void task.destroy().catch(() => undefined),
    };
  },
};

export const shrinkHere: ShrinkPicture = async (bytes, width, height) => {
  const canvas = loadCanvas();
  const source = await canvas.loadImage(bytes);
  const target = canvas.createCanvas(width, height);
  target.getContext("2d").drawImage(source, 0, 0, width, height);
  return { png: target.toBuffer("image/png"), width, height };
};
