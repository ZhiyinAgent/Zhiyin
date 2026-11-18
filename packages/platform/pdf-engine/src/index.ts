/**
 * pdf.js and a canvas for it to draw on, loaded and configured in one place,
 * so reading a PDF for the model and drawing one for a person open documents
 * the same way.
 */

export type {
  Canvas,
  CanvasContext,
  CanvasModule,
  PdfDocument,
  PdfLoadingTask,
  PdfPage,
  PdfViewport,
  Pdfjs,
} from "./pdf-engine.js";
export {
  loadCanvas,
  loadPdfjs,
  pdfDocumentOptions,
  textOfItem,
} from "./pdf-engine.js";
export { svgWithFallbackFont } from "./svg-fallback.js";
