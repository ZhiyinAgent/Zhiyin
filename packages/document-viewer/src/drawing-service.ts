/**
 * The drawing itself: what runs inside the contained process.
 *
 * It opens a document from bytes it is given, says how large each page is,
 * and draws one page at a time onto a canvas, sent back as a PNG. For the
 * model it also reads a PDF page's text, or draws the page as a JPEG. It reads
 * no file, opens no connection, and keeps a document only until it is told to
 * let go of that revision.
 */

import type { DocumentPageSize } from "@zhiyin/contract";
import {
  loadCanvas,
  loadPdfjs,
  pdfDocumentOptions,
  textOfItem,
  type CanvasModule,
  type PdfDocument,
  type PdfLoadingTask,
} from "@zhiyin/pdf-engine";
import type {
  DrawingFailure,
  DrawingPort,
  DrawingReply,
  DrawingRequest,
} from "./drawing-protocol.js";
import { fittedSvg } from "./svg-size.js";

/** A PDF point is 1/72 inch; a CSS pixel is 1/96. */
const cssPixelsPerPoint = 96 / 72;
/** The tools' own bound on a picture, `maximumImagePixels`, on its long side. */
const maximumPictureSide = 2000;

type Opened =
  | {
      readonly kind: "pdf";
      readonly task: PdfLoadingTask;
      readonly document: PdfDocument;
      readonly pages: readonly DocumentPageSize[];
    }
  | {
      readonly kind: "picture";
      readonly image: { readonly width: number; readonly height: number };
      readonly pages: readonly DocumentPageSize[];
    };

const refused = (id: number, failure: DrawingFailure): DrawingReply => ({
  id,
  ok: false,
  failure,
});

/** A picture past the bound is drawn at the bound, keeping its proportions. */
function pictureSize(image: {
  readonly width: number;
  readonly height: number;
}): DocumentPageSize {
  const scale = Math.min(
    1,
    maximumPictureSide / Math.max(image.width, image.height),
  );
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

export function serveDrawing(port: DrawingPort): void {
  const opened = new Map<string, Opened>();
  let canvas: CanvasModule | undefined;
  // The canvas first: pdf.js installs its own shape classes as it loads, and
  // the ones that draw have to be the ones the canvas accepts.
  const canvasModule = () => (canvas ??= loadCanvas());

  async function open(
    request: Extract<DrawingRequest, { kind: "open" }>,
  ): Promise<DrawingReply> {
    const { id, revision, bytes } = request;
    if (request.format === "picture" || request.format === "svg") {
      // An SVG is sized before it is decoded, because decoding draws it.
      const source =
        request.format === "svg"
          ? fittedSvg(bytes, maximumPictureSide)
          : Buffer.from(bytes);
      if (!source) return refused(id, "damaged");
      try {
        const image = await canvasModule().loadImage(source);
        if (!image.width || !image.height) return refused(id, "damaged");
        const pages = [pictureSize(image)];
        opened.set(revision, { kind: "picture", image, pages });
        return { id, ok: true, kind: "opened", pages };
      } catch {
        return refused(id, "damaged");
      }
    }
    canvasModule();
    const task = (await loadPdfjs()).getDocument(pdfDocumentOptions(bytes));
    let document: PdfDocument;
    try {
      document = await task.promise;
    } catch (error) {
      await task.destroy().catch(() => undefined);
      return refused(
        id,
        error instanceof Error && error.name === "PasswordException"
          ? "protected"
          : "damaged",
      );
    }
    try {
      const pages: DocumentPageSize[] = [];
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const { width, height } = page.getViewport({
          scale: cssPixelsPerPoint,
        });
        pages.push({ width: Math.round(width), height: Math.round(height) });
        page.cleanup();
      }
      opened.set(revision, { kind: "pdf", task, document, pages });
      return { id, ok: true, kind: "opened", pages };
    } catch {
      await task.destroy().catch(() => undefined);
      return refused(id, "damaged");
    }
  }

  async function draw(
    request: Extract<DrawingRequest, { kind: "draw" }>,
  ): Promise<DrawingReply> {
    const { id, revision, page: number } = request;
    const document = opened.get(revision);
    if (!document) return refused(id, "not-open");
    const size = Number.isInteger(number)
      ? document.pages[number - 1]
      : undefined;
    if (!size) return refused(id, "no-such-page");
    // Sharp at the width asked for, never past twice a page's own size: a
    // wider request is a zoom the window can make from the pixels it has. A
    // picture is never drawn past its own pixels, which are already bounded.
    const ceiling = size.width * (document.kind === "pdf" ? 2 : 1);
    const width = Math.max(1, Math.round(Math.min(request.width, ceiling)));
    const scale = width / size.width;
    const height = Math.max(1, Math.round(size.height * scale));
    try {
      const target = canvasModule().createCanvas(width, height);
      const context = target.getContext("2d");
      // A page carries no background of its own; without one a PDF's text
      // arrives on transparency, and the window's dark theme shows through.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      if (document.kind === "picture") {
        context.drawImage(document.image, 0, 0, width, height);
      } else {
        const page = await document.document.getPage(number);
        const viewport = page.getViewport({
          scale: cssPixelsPerPoint * scale,
        });
        await page.render({ canvasContext: context, viewport, canvas: target })
          .promise;
        page.cleanup();
      }
      const png = target.toBuffer("image/png");
      return {
        id,
        ok: true,
        kind: "drawn",
        png: new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
        width,
        height,
      };
    } catch {
      return refused(id, "failed");
    }
  }

  /** The PDF page a model request names, or why there is none. */
  function pdfPage(
    request: Extract<DrawingRequest, { kind: "text" | "picture" }>,
  ): PdfDocument | DrawingFailure {
    const document = opened.get(request.revision);
    if (!document) return "not-open";
    if (
      document.kind !== "pdf" ||
      !Number.isInteger(request.page) ||
      request.page < 1 ||
      request.page > document.pages.length
    )
      return "no-such-page";
    return document.document;
  }

  async function text(
    request: Extract<DrawingRequest, { kind: "text" }>,
  ): Promise<DrawingReply> {
    const document = pdfPage(request);
    if (typeof document === "string") return refused(request.id, document);
    try {
      const page = await document.getPage(request.page);
      const { items } = await page.getTextContent();
      page.cleanup();
      return {
        id: request.id,
        ok: true,
        kind: "text",
        strings: items.map(textOfItem),
      };
    } catch {
      return refused(request.id, "failed");
    }
  }

  async function picture(
    request: Extract<DrawingRequest, { kind: "picture" }>,
  ): Promise<DrawingReply> {
    const document = pdfPage(request);
    if (typeof document === "string") return refused(request.id, document);
    try {
      const page = await document.getPage(request.page);
      const viewport = page.getViewport({ scale: request.scale });
      const target = canvasModule().createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const context = target.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, target.width, target.height);
      await page.render({ canvasContext: context, viewport, canvas: target })
        .promise;
      page.cleanup();
      const jpeg = target.toBuffer("image/jpeg", request.quality);
      return {
        id: request.id,
        ok: true,
        kind: "picture",
        jpeg: new Uint8Array(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength),
      };
    } catch {
      return refused(request.id, "failed");
    }
  }

  async function release(revision: string): Promise<void> {
    const document = opened.get(revision);
    opened.delete(revision);
    if (document?.kind === "pdf") {
      await document.document.cleanup().catch(() => undefined);
      await document.task.destroy().catch(() => undefined);
    }
  }

  // One request at a time, in the order they came: a page is never drawn from
  // a revision that a request before it let go of.
  let queue = Promise.resolve();
  port.receive((request) => {
    queue = queue.then(async () => {
      try {
        switch (request.kind) {
          case "open":
            port.send(await open(request));
            return;
          case "draw":
            port.send(await draw(request));
            return;
          case "text":
            port.send(await text(request));
            return;
          case "picture":
            port.send(await picture(request));
            return;
          case "release":
            await release(request.revision);
            port.send({ id: request.id, ok: true, kind: "released" });
            return;
        }
      } catch {
        port.send(refused(request.id, "failed"));
      }
    });
  });
}
