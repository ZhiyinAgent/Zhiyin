import { useState } from "react";
import type { DocumentPageDrawing, DocumentPanelState } from "@zhiyin/contract";
import {
  FrameNotice,
  FrameWaiting,
  HeldUntilReady,
  Icon,
  SurfaceFrame,
} from "../shared/index.js";
import type { Zoom } from "./pageDrawings.js";
import { documentShape } from "./documentShape.js";
import { PdfView } from "./PdfView.js";
import { PictureView } from "./PictureView.js";
import { VideoView } from "./VideoView.js";
import type { DocumentFrame } from "./documentFrame.js";
import styles from "./document.module.css";

type Opened = Exclude<DocumentPanelState, { status: "closed" }>;

/**
 * The document surface beside the conversation (ADR 0019): one frame, filled
 * by what shows the kind of file it is: a PDF's pages, a picture, or a video
 * the 3D studio rendered. Nothing of a PDF or a picture reaches the window:
 * only its name, its folder, the size of each page and pictures of the pages
 * it asks for. A video is played from the copy the core kept of it.
 *
 * Another document is drawn behind the one shown, which stays until the new
 * one's page is drawn, so the panel goes from one finished picture to the
 * next.
 */
export function DocumentPanel({
  document,
  drawPage,
  onShow,
  onOpen,
  onShowInFolder,
  onClose,
  onFitHeight,
  onReady,
}: {
  document: Opened;
  drawPage: (
    revision: string,
    page: number,
    width: number,
  ) => Promise<DocumentPageDrawing>;
  /** Shows another of the conversation's documents. */
  onShow: (path: string) => void;
  onOpen: (path: string) => void;
  onShowInFolder: (path: string) => void;
  onClose: () => void;
  /**
   * Asks the space for this many pixels more width, or less, so a portrait
   * page at fit-width fills the panel's height.
   */
  onFitHeight?: (change: number) => void;
  /** What the panel shows is ready to be seen: its page is drawn, or it says why not. */
  onReady?: () => void;
}) {
  // How documents are zoomed holds from one document to the next.
  const [zoom, setZoom] = useState<Zoom>("fit");

  return (
    <HeldUntilReady
      value={document}
      itemOf={(shown: Opened) => shown.path}
      waits={(shown: Opened) =>
        shown.status === "opening" ||
        (shown.status === "shown" && shown.kind !== "video")
      }
      onReady={onReady}
      render={drawn}
    />
  );

  /** One document in the panel's frame, as far as it has come. */
  function drawn(document: Opened, ready: () => void) {
    const frame: DocumentFrame = {
      label: "Document",
      title: document.name,
      ...(document.folder ? { detail: document.folder } : {}),
      menu: {
        label: "Documents",
        listLabel: "This conversation's documents",
        items: document.documents.map((item) => ({
          id: item.path,
          name: item.name,
          ...(item.folder ? { detail: item.folder } : {}),
        })),
        current: document.path,
        onPick: onShow,
      },
      close: { label: "Close document", onClose },
    };

    const elsewhere = (
      <>
        {document.status !== "opening" && document.openable && (
          <button
            className="button button--quiet button--small"
            type="button"
            onClick={() => onOpen(document.path)}
          >
            Open
          </button>
        )}
        <button
          className={`button button--quiet button--small ${styles["document-panel__folder-button"]}`}
          type="button"
          data-tip="Show in folder"
          onClick={() => onShowInFolder(document.path)}
        >
          <Icon name="folder" />
          {/* Hidden, not removed, where the panel is narrow: still its name. */}
          <span className={styles["document-panel__label"]}>
            Show in folder
          </span>
        </button>
      </>
    );

    if (document.status === "opening")
      return (
        <SurfaceFrame {...frame} icon="file">
          <FrameWaiting>Opening {document.name}…</FrameWaiting>
        </SurfaceFrame>
      );
    if (document.status === "failed")
      return (
        <SurfaceFrame {...frame} icon="file">
          <FrameNotice actions={elsewhere}>{document.reason}</FrameNotice>
        </SurfaceFrame>
      );

    if (document.kind === "video")
      return (
        <VideoView
          // Each render is a new copy at a new source: a new player, which
          // remembers nothing of one that could not play the last.
          key={document.source}
          frame={frame}
          document={document}
          actions={elsewhere}
        />
      );

    const shape = documentShape(document);
    const view = {
      frame,
      document,
      zoom,
      onZoom: setZoom,
      actions: elsewhere,
      drawPage,
      onDrawn: ready,
      ...(onFitHeight && shape.aspect
        ? { fitHeight: { aspect: shape.aspect, ask: onFitHeight } }
        : {}),
    };
    return document.kind === "picture" ? (
      <PictureView key={document.path} {...view} />
    ) : (
      <PdfView key={document.path} {...view} />
    );
  }
}
