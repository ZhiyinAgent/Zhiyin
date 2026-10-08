import { useState } from "react";
import type { DocumentPageDrawing, DocumentPanelState } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import { DocumentMenu } from "./DocumentMenu.js";
import { DocumentPages, type Jump, type Zoom } from "./DocumentPages.js";
import { documentShape } from "./documentShape.js";
import styles from "./document.module.css";

type Opened = Exclude<DocumentPanelState, { status: "closed" }>;

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * A PDF or picture beside the conversation, as pictures of its pages drawn by
 * the core (ADR 0018). Nothing of the file reaches the window: only its name,
 * its folder, the size of each page and PNGs of the pages it asks for.
 */
export function DocumentPanel({
  document,
  drawPage,
  onShow,
  onOpen,
  onShowInFolder,
  onClose,
  onFitHeight,
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
}) {
  const [zoom, setZoom] = useState<Zoom>("fit");
  const shape = documentShape(document);
  // The page being read belongs to the document it was read in.
  const [reading, setReading] = useState({ path: document.path, page: 1 });
  const [jump, setJump] = useState<Jump>();
  const page = reading.path === document.path ? reading.page : 1;
  const goTo = (next: number, smooth: boolean) => {
    setReading({ path: document.path, page: next });
    setJump((before) => ({ id: (before?.id ?? 0) + 1, page: next, smooth }));
  };
  // The agent pointed at a page: go there, each time it points.
  const pointed = document.status === "shown" ? document.pointed : undefined;
  const [seenPointing, setSeenPointing] = useState<number>();
  if (pointed && pointed.count !== seenPointing) {
    setSeenPointing(pointed.count);
    goTo(pointed.page, !prefersReducedMotion());
  }

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
        <span className={styles["document-panel__label"]}>Show in folder</span>
      </button>
    </>
  );

  return (
    <aside className={styles["document-panel"]} aria-label="Document">
      <div className={styles["document-panel__chrome"]}>
        <div className={styles["document-panel__title"]}>
          <Icon
            name={
              document.status === "shown" && document.kind === "picture"
                ? "image"
                : "file"
            }
          />
          <h2>{document.name}</h2>
          {document.folder && (
            <span className={styles["document-panel__folder"]}>
              {document.folder}
            </span>
          )}
          {document.documents.length > 1 && (
            <DocumentMenu
              documents={document.documents}
              current={document.path}
              onShow={onShow}
            />
          )}
          <button
            className={styles["document-panel__icon-button"]}
            type="button"
            aria-label="Close document"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        {document.status === "shown" && (
          <div className={styles["document-panel__bar"]}>
            {document.kind === "pdf" && (
              <span className={styles["document-panel__count"]}>
                <span className={styles["document-panel__long"]}>
                  Page {Math.min(page, document.pages.length)} of{" "}
                  {document.pages.length}
                </span>
                <span className={styles["document-panel__short"]} aria-hidden>
                  {Math.min(page, document.pages.length)} /{" "}
                  {document.pages.length}
                </span>
              </span>
            )}
            <div
              className={styles["document-panel__zoom"]}
              role="group"
              aria-label="Zoom"
            >
              <button
                type="button"
                aria-pressed={zoom === "fit"}
                onClick={() => setZoom("fit")}
              >
                <span className={styles["document-panel__long"]}>
                  Fit width
                </span>
                <span className={styles["document-panel__short"]} aria-hidden>
                  Fit
                </span>
              </button>
              <button
                type="button"
                aria-pressed={zoom === "actual"}
                onClick={() => setZoom("actual")}
              >
                100%
              </button>
            </div>
            <div className={styles["document-panel__actions"]}>{elsewhere}</div>
          </div>
        )}
      </div>

      {document.status === "opening" && (
        <div className={styles["document-panel__waiting"]}>
          <p role="status">
            <span className={styles["document-panel__spinner"]} />
            Opening {document.name}…
          </p>
        </div>
      )}
      {document.status === "failed" && (
        <div className={styles["document-panel__notice"]} role="alert">
          <Icon name="alert" />
          <div>
            <p>{document.reason}</p>
            <div className={styles["document-panel__notice-actions"]}>
              {elsewhere}
            </div>
          </div>
        </div>
      )}
      {document.status === "shown" && (
        <DocumentPages
          key={document.path}
          document={document}
          zoom={zoom}
          page={page}
          jump={jump}
          onRead={(next) => setReading({ path: document.path, page: next })}
          onJump={(next) => goTo(next, false)}
          drawPage={drawPage}
          {...(onFitHeight && shape.aspect
            ? { fitHeight: { aspect: shape.aspect, ask: onFitHeight } }
            : {})}
        />
      )}
    </aside>
  );
}
