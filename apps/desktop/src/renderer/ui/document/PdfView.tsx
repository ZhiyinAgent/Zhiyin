import { useState } from "react";
import { SurfaceFrame } from "../shared/index.js";
import { DocumentPages, type Jump } from "./DocumentPages.js";
import type { DocumentViewProps } from "./documentFrame.js";
import { ZoomChoice } from "./ZoomChoice.js";
import styles from "./document.module.css";

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * A PDF's pages, read down the panel at its width: the page being read is
 * counted in the bar, and a page the agent points at is gone to, each time
 * it points.
 */
export function PdfView({
  frame,
  document,
  zoom,
  onZoom,
  actions,
  drawPage,
  fitHeight,
  onDrawn,
}: DocumentViewProps) {
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState<Jump>();
  const goTo = (next: number, smooth: boolean) => {
    setPage(next);
    setJump((before) => ({ id: (before?.id ?? 0) + 1, page: next, smooth }));
  };
  const pointed = document.pointed;
  const [seenPointing, setSeenPointing] = useState<number>();
  if (pointed && pointed.count !== seenPointing) {
    setSeenPointing(pointed.count);
    goTo(pointed.page, !prefersReducedMotion());
  }
  const shownPage = Math.min(page, document.pages.length);

  return (
    <SurfaceFrame
      {...frame}
      icon="file"
      bar={
        <>
          <span className={styles["document-panel__count"]}>
            <span className={styles["document-panel__long"]}>
              Page {shownPage} of {document.pages.length}
            </span>
            <span className={styles["document-panel__short"]} aria-hidden>
              {shownPage} / {document.pages.length}
            </span>
          </span>
          <ZoomChoice zoom={zoom} onZoom={onZoom} fit="Fit width" />
          <div className={styles["document-panel__actions"]}>{actions}</div>
        </>
      }
    >
      <DocumentPages
        document={document}
        fit="width"
        zoom={zoom}
        onZoom={onZoom}
        page={page}
        jump={jump}
        onRead={setPage}
        onJump={(next) => goTo(next, false)}
        drawPage={drawPage}
        fitHeight={fitHeight}
        onDrawn={onDrawn}
      />
    </SurfaceFrame>
  );
}
