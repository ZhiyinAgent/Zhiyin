/**
 * PDFs and pictures shown beside the conversation, drawn as pages in a
 * contained process and sent to the window as pictures, and the videos
 * Zhiyin's 3D studio renders, played from copies kept when they were written.
 */

export { serveDrawing } from "./drawing-service.js";
export type {
  DrawingFormat,
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
export { KeptVideos, type FileNow } from "./kept-videos.js";
export {
  ContainedPdfPages,
  type ContainedPdf,
  type PlacedPage,
} from "./contained-pdf-pages.js";
export type { PlacedText } from "./drawing-protocol.js";
export {
  ContainedPictures,
  type DrawnPixels,
  type OpenedPixels,
  type SmallerPicture,
} from "./contained-pictures.js";
