/**
 * PDFs and pictures shown beside the conversation, drawn as pages in a
 * contained process and sent to the window as pictures.
 *
 * Boundaries and invariants:
 * docs/architecture/features/document-viewer/README.md
 */

export { serveDrawing } from "./drawing-service.js";
export type {
  DrawingPort,
  DrawingReply,
  DrawingRequest,
} from "./drawing-protocol.js";
export {
  DrawingHost,
  type DrawingContainment,
  type DrawingProcess,
  type StartDrawingProcess,
} from "./drawing-host.js";
export {
  DocumentViewer,
  type LocatedDocument,
  type ShowOutcome,
} from "./document-viewer.js";
export { mayOpenInItsOwnApp } from "./document-files.js";
export { ContainedPdfPages, type ContainedPdf } from "./contained-pdf-pages.js";
