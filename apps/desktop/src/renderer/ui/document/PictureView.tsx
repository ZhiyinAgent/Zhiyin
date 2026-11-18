import { SurfaceFrame } from "../shared/index.js";
import { DocumentPages } from "./DocumentPages.js";
import type { DocumentViewProps } from "./documentFrame.js";
import { ZoomChoice } from "./ZoomChoice.js";
import styles from "./document.module.css";

/** A picture, seen whole at Fit and at its own pixels at 100%. */
export function PictureView({
  frame,
  document,
  zoom,
  onZoom,
  actions,
  drawPage,
  fitHeight,
  onDrawn,
}: DocumentViewProps) {
  return (
    <SurfaceFrame
      {...frame}
      icon="image"
      bar={
        <>
          <ZoomChoice zoom={zoom} onZoom={onZoom} fit="Fit" />
          <div className={styles["document-panel__actions"]}>{actions}</div>
        </>
      }
    >
      <DocumentPages
        document={document}
        fit="whole"
        zoom={zoom}
        onZoom={onZoom}
        page={1}
        jump={undefined}
        onRead={() => undefined}
        onJump={() => undefined}
        drawPage={drawPage}
        fitHeight={fitHeight}
        onDrawn={onDrawn}
      />
    </SurfaceFrame>
  );
}
