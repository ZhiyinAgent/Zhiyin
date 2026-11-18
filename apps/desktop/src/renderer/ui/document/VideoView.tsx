import { useState, type ReactNode } from "react";
import { FrameNotice, SurfaceFrame } from "../shared/index.js";
import type { DocumentFrame, VideoDocument } from "./documentFrame.js";
import styles from "./document.module.css";

/**
 * A video the 3D studio rendered, in the player Chromium draws, with its own
 * controls and keys. It never starts by itself: the person plays it. A video
 * the player cannot play is said so, with the way to its own app.
 */
export function VideoView({
  frame,
  document,
  actions,
}: {
  frame: DocumentFrame;
  document: VideoDocument;
  /** Opening it in its own app, and showing it in its folder. */
  actions: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <SurfaceFrame
      {...frame}
      icon="video"
      // Once it cannot be played, its other ways are offered with the reason.
      bar={
        failed ? undefined : (
          <div className={styles["document-panel__actions"]}>{actions}</div>
        )
      }
    >
      {failed ? (
        <FrameNotice actions={actions}>
          {document.name} could not be played here. Open it in its own app.
        </FrameNotice>
      ) : (
        <div className={styles["document-panel__video"]}>
          <video
            src={document.source}
            aria-label={document.name}
            controls
            preload="metadata"
            onError={() => setFailed(true)}
          />
        </div>
      )}
    </SurfaceFrame>
  );
}
