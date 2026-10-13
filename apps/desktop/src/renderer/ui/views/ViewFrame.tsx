import {
  createContext,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { ArtifactExport } from "@zhiyin/contract";
import { useDrawingZoom, type DrawingSize } from "./drawingZoom.js";
import styles from "./views.module.css";

/**
 * How a drawing tells the frame around it what size it came out. A context
 * rather than a prop, because the frame does not know what it is framing and
 * the drawing arrives later than the frame does.
 */
export const ReportDrawingSize = createContext<
  ((size: DrawingSize | undefined) => void) | undefined
>(undefined);

/** Marks focus that arrived from a pointer, so the keyboard ring stays off. */
const pointerFocus = "data-pointer-focus";

/**
 * A saved view leaves the app that styled it. What the stylesheet was painting
 * has to travel with the file, or the person opens an image that is missing the
 * lines and text they were looking at when they asked to save it.
 */
const painted = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "font",
  "opacity",
] as const;

function standalone(drawn: SVGElement): string {
  const copy = drawn.cloneNode(true) as SVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const originals = [drawn, ...drawn.querySelectorAll("*")];
  [copy, ...copy.querySelectorAll("*")].forEach((element, index) => {
    const source = originals[index];
    if (!source) return;
    const computed = getComputedStyle(source);
    for (const property of painted) {
      const value = computed.getPropertyValue(property);
      if (value) (element as SVGElement).style.setProperty(property, value);
    }
  });
  return copy.outerHTML;
}

/**
 * How a person moves around a drawing by hand: dragging it with a pointer,
 * scrolling it with the arrow keys, and zooming it with + and −. These are
 * what the frame's body listens for, and each acts on the body it was heard
 * on; only the mark on focus that came from a pointer is kept for a view that
 * does not move.
 */
function useDrawingMovement(
  /** The frame shows a drawing that zooms, and not its source. */
  moves: boolean,
  changeZoom: (direction: 1 | -1) => void,
): Pick<
  HTMLAttributes<HTMLDivElement>,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onBlur"
  | "onKeyDown"
> {
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  return {
    onPointerDown: (event) => {
      // Focus is about to land here from a mouse. Chromium counts that as
      // focus-visible on a region like this one, so a ring meant for
      // keyboard users appears around a drawing somebody just grabbed to
      // drag. Marked as pointer-driven, and unmarked the moment a key is
      // pressed, so the ring is there for whoever is actually navigating.
      const body = event.currentTarget;
      body.setAttribute(pointerFocus, "");
      if (!moves) return;
      event.preventDefault();
      body.focus({ preventScroll: true });
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        left: body.scrollLeft,
        top: body.scrollTop,
      };
      body.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event) => {
      if (!drag.current) return;
      const body = event.currentTarget;
      body.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
      body.scrollTop = drag.current.top - (event.clientY - drag.current.y);
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onBlur: (event) => event.currentTarget.removeAttribute(pointerFocus),
    onKeyDown: (event) => {
      event.currentTarget.removeAttribute(pointerFocus);
      if (!moves) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeZoom(1);
      } else if (event.key === "-") {
        event.preventDefault();
        changeZoom(-1);
      } else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const amount = 48;
        event.currentTarget.scrollBy?.({
          left:
            event.key === "ArrowRight"
              ? amount
              : event.key === "ArrowLeft"
                ? -amount
                : 0,
          top:
            event.key === "ArrowDown"
              ? amount
              : event.key === "ArrowUp"
                ? -amount
                : 0,
        });
      }
    },
  };
}

export function ViewFrame({
  title,
  kind,
  source,
  children,
  zoomable = false,
  table,
  onSave,
}: {
  title: string;
  kind: string;
  source: string;
  children: ReactNode;
  zoomable?: boolean;
  /** The source read as rows. With it, the source itself waits under Technical. */
  table?: ReactNode;
  onSave?: (svg: string) => Promise<ArtifactExport>;
}) {
  const [tab, setTab] = useState<"rendered" | "source">("rendered");
  const [status, setStatus] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const {
    drawing,
    reportDrawing,
    zoom,
    fit,
    overflows,
    changeZoom,
    fitToFrame,
  } = useDrawingZoom(body, zoomable, tab === "rendered");
  const movement = useDrawingMovement(
    zoomable && tab === "rendered",
    changeZoom,
  );
  const sourceLabel = kind === "diagram" ? "Source" : "Data";
  const showZoom = zoomable && tab === "rendered" && drawing !== undefined;
  const footerContent = showZoom || Boolean(status);

  async function save() {
    const drawn = body.current?.querySelector("svg");
    const svg = drawn ? standalone(drawn) : undefined;
    if (!svg || !onSave) return;
    setStatus("Saving…");
    const result = await onSave(svg);
    setStatus(
      result.status === "saved"
        ? "Saved"
        : result.status === "cancelled"
          ? "Save cancelled"
          : result.reason,
    );
  }

  return (
    <section className={styles["task-view"]} aria-label={`${title} view`}>
      <header className={styles["task-view__header"]}>
        <div>
          <span className={styles["task-view__eyebrow"]}>
            {kind.replaceAll("-", " ")}
          </span>
          <h3>{title}</h3>
        </div>
        <div className={styles["task-view__actions"]}>
          <div
            className={styles["task-view__tabs"]}
            role="tablist"
            aria-label={`${title} view mode`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "rendered"}
              onClick={() => setTab("rendered")}
            >
              Rendered
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "source"}
              onClick={() => setTab("source")}
            >
              {sourceLabel}
            </button>
          </div>
          {onSave && (
            <button
              type="button"
              className={styles["task-view__save"]}
              onClick={() => void save()}
            >
              Save image
            </button>
          )}
        </div>
      </header>
      <div
        ref={body}
        className={styles["task-view__body"]}
        role="region"
        aria-label={`${title} ${kind}`}
        tabIndex={tab === "rendered" ? 0 : -1}
        {...movement}
      >
        <div
          hidden={tab !== "rendered"}
          className={`${styles["task-view__canvas"]}${zoomable ? ` ${styles["task-view__canvas--zoomable"]}` : ""}`}
          /**
           * A width, not a transform: a transform does not change layout, so
           * the scroll container would never learn there was more to reach.
           * The drawing takes this width, and the canvas wraps the drawing,
           * once the caps that pin it to its resting size are off — which is
           * what the zoomable class does.
           */
          style={
            zoomable && drawing
              ? ({
                  "--drawing-width": `${(drawing.width * zoom) / 100}px`,
                } as CSSProperties)
              : undefined
          }
        >
          <ReportDrawingSize.Provider value={reportDrawing}>
            {children}
          </ReportDrawingSize.Provider>
        </div>
        <ViewSource source={source} table={table} hidden={tab !== "source"} />
      </div>
      {/*
        Only when it has something to say. A chart has no zoom and, until it is
        saved, nothing to report — an empty footer is then a bar of nothing
        ruled off under every chart in the conversation.
      */}
      {footerContent && (
        <footer className={styles["task-view__footer"]}>
          {showZoom && (
            <ZoomControls
              zoom={zoom}
              fit={fit}
              onStep={changeZoom}
              onFit={fitToFrame}
            />
          )}
          {showZoom && overflows && (
            <span className={styles["task-view__hint"]}>
              Drag to move around
            </span>
          )}
          {status && <span role="status">{status}</span>}
        </footer>
      )}
    </section>
  );
}

/**
 * What a view was drawn from. Where it reads as rows it is shown as rows, and
 * the source itself waits under Technical; otherwise it is shown as written.
 */
function ViewSource({
  source,
  table,
  hidden,
}: {
  source: string;
  table: ReactNode;
  hidden: boolean;
}) {
  return table ? (
    <div hidden={hidden} className={styles["task-view__data"]}>
      {table}
      <details className={styles["task-view__technical"]}>
        <summary>Technical</summary>
        <pre className={styles["task-view__source"]}>
          <code>{source}</code>
        </pre>
      </details>
    </div>
  ) : (
    <pre hidden={hidden} className={styles["task-view__source"]}>
      <code>{source}</code>
    </pre>
  );
}

/** A drawing's zoom: a step out, where it stands, a step in, and back to fit. */
function ZoomControls({
  zoom,
  fit,
  onStep,
  onFit,
}: {
  zoom: number;
  fit: number;
  onStep: (direction: 1 | -1) => void;
  onFit: () => void;
}) {
  return (
    <div className={styles["task-view__zoom"]} aria-label="Diagram zoom">
      <button type="button" onClick={() => onStep(-1)} aria-label="Zoom out">
        −
      </button>
      <span aria-live="polite">{zoom}%</span>
      <button type="button" onClick={() => onStep(1)} aria-label="Zoom in">
        +
      </button>
      <button
        type="button"
        className={styles["task-view__zoom-reset"]}
        onClick={onFit}
        disabled={zoom === fit}
      >
        Fit
      </button>
    </div>
  );
}
