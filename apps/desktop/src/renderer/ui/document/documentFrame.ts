import type { ReactNode } from "react";
import type { DocumentPageDrawing, DocumentPanelState } from "@zhiyin/contract";
import type { FrameParts, SurfaceMenuProps } from "../shared/index.js";
import type { Zoom } from "./pageDrawings.js";

/** What every view of a document is framed with, whatever it draws. */
export type DocumentFrame = FrameParts & {
  readonly title: string;
  readonly detail?: string;
  readonly menu: SurfaceMenuProps;
};

type Shown = Extract<DocumentPanelState, { status: "shown" }>;

/** A shown document drawn as pages: a PDF, or a picture. */
type PagedDocument = Extract<Shown, { kind: "pdf" | "picture" }>;
/** A shown video the 3D studio rendered, played from its source. */
export type VideoDocument = Extract<Shown, { kind: "video" }>;

/** What the document surface hands the view that draws a shown document. */
export type DocumentViewProps<Document extends Shown = PagedDocument> = {
  frame: DocumentFrame;
  document: Document;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  /** Opening it in its own app, and showing it in its folder. */
  actions: ReactNode;
  drawPage: (
    revision: string,
    page: number,
    width: number,
  ) => Promise<DocumentPageDrawing>;
  fitHeight?: {
    readonly aspect: number;
    readonly ask: (change: number) => void;
  };
  /** What is shown is ready: the page being read is drawn, or cannot be. */
  onDrawn?: () => void;
};
