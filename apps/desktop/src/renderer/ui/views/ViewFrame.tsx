import {
  createContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ArtifactExport } from "@zhiyin/contract";
import styles from "./views.module.css";

/**
 * Zoom is the drawing's real size: at 100% its labels are the size they were
 * drawn at. Far enough out to see a whole large diagram, far enough in to read
 * a label on one. Steps land on round numbers so the readout stays a number a
 * person can hold on to, even after fitting a drawing has put it at 37%.
 */
const minimumZoom = 25;
const maximumZoom = 400;
const zoomStep = 10;

/**
 * The smallest size a drawing opens at. Mermaid draws labels at 16px; at 75%
 * they are 12px, the smallest text anywhere in the app. A drawing that would
 * have to be smaller than this to fit opens here instead, and is dragged.
 */
const readableZoom = 75;

/** The canvas's padding, both sides together: room the drawing does not get. */
const canvasPadding = 40;

/** The size a drawing was drawn at, in its own pixels. */
export type DrawingSize = { readonly width: number; readonly height: number };

/**
 * How a drawing tells the frame around it what size it came out. A context
 * rather than a prop, because the frame does not know what it is framing and
 * the drawing arrives later than the frame does.
 */
export const ReportDrawingSize = createContext<
  ((size: DrawingSize | undefined) => void) | undefined
>(undefined);

type FrameSize = { readonly width: number; readonly height?: number };

/** The largest real size, up to 100%, at which the whole drawing shows. */
function fittingZoom(drawing: DrawingSize, frame: FrameSize): number {
  if (frame.width <= 0) return 100;
  const across = (frame.width - canvasPadding) / drawing.width;
  const down =
    frame.height === undefined
      ? Infinity
      : (frame.height - canvasPadding) / drawing.height;
  return Math.max(1, Math.min(100, Math.floor(Math.min(across, down) * 100)));
}

/** The next round step in either direction, whatever the zoom is now. */
function steppedZoom(zoom: number, direction: 1 | -1): number {
  return direction === 1
    ? Math.floor(zoom / zoomStep) * zoomStep + zoomStep
    : Math.ceil(zoom / zoomStep) * zoomStep - zoomStep;
}

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
  /** Unset until a person zooms: the drawing opens at its fitting size. */
  const [chosenZoom, setZoom] = useState<number>();
  const [drawing, setDrawing] = useState<DrawingSize>();
  const [frame, setFrame] = useState<FrameSize>({ width: 0 });
  const [status, setStatus] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const sourceLabel = kind === "diagram" ? "Source" : "Data";
  const fit = drawing ? fittingZoom(drawing, frame) : 100;
  const zoom = chosenZoom ?? Math.min(100, Math.max(fit, readableZoom));
  /** Below a quarter only when that is what it takes to see all of it. */
  const smallestZoom = Math.min(minimumZoom, fit);
  const showZoom = zoomable && tab === "rendered" && drawing !== undefined;
  /**
   * Worked out rather than read from the scroll container, so it is right on
   * the render that changes the zoom instead of one frame later.
   */
  const overflows =
    drawing !== undefined &&
    frame.width > 0 &&
    ((drawing.width * zoom) / 100 + canvasPadding > frame.width + 1 ||
      (frame.height !== undefined &&
        (drawing.height * zoom) / 100 + canvasPadding > frame.height + 1));
  const footerContent = showZoom || Boolean(status);
  const changeZoom = (direction: 1 | -1) =>
    setZoom(
      Math.min(
        maximumZoom,
        Math.max(smallestZoom, steppedZoom(zoom, direction)),
      ),
    );
  /** The wheel listener is registered once per drawing, and zooms from here. */
  const zoomFromWheel = useEffectEvent(changeZoom);

  /**
   * The frame's width, and the height it stops growing at. Measured once the
   * drawing is in, and again whenever the frame is resized, since what fits
   * depends on both.
   */
  useLayoutEffect(() => {
    const element = body.current;
    if (!element || !zoomable || !drawing) return;
    const measure = () => {
      const limit = Number.parseFloat(getComputedStyle(element).maxHeight);
      const next: FrameSize = Number.isFinite(limit)
        ? { width: element.clientWidth, height: limit }
        : { width: element.clientWidth };
      setFrame((previous) =>
        previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [zoomable, drawing]);

  /**
   * The wheel is registered by hand because React's wheel listener is passive,
   * and a passive listener cannot stop the page scrolling underneath. Zooming
   * a diagram while the thread slides away is not zooming.
   */
  useEffect(() => {
    const element = body.current;
    if (!element || !zoomable || tab !== "rendered") return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      zoomFromWheel(event.deltaY < 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomable, tab]);

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
        onPointerDown={(event) => {
          // Focus is about to land here from a mouse. Chromium counts that as
          // focus-visible on a region like this one, so a ring meant for
          // keyboard users appears around a drawing somebody just grabbed to
          // drag. Marked as pointer-driven, and unmarked the moment a key is
          // pressed, so the ring is there for whoever is actually navigating.
          body.current?.setAttribute(pointerFocus, "");
          if (!zoomable || tab !== "rendered" || !body.current) return;
          event.preventDefault();
          body.current.focus({ preventScroll: true });
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: body.current.scrollLeft,
            top: body.current.scrollTop,
          };
          body.current.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current || !body.current) return;
          body.current.scrollLeft =
            drag.current.left - (event.clientX - drag.current.x);
          body.current.scrollTop =
            drag.current.top - (event.clientY - drag.current.y);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onBlur={() => body.current?.removeAttribute(pointerFocus)}
        onKeyDown={(event) => {
          body.current?.removeAttribute(pointerFocus);
          if (!zoomable || tab !== "rendered") return;
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            changeZoom(1);
          } else if (event.key === "-") {
            event.preventDefault();
            changeZoom(-1);
          } else if (event.key.startsWith("Arrow")) {
            event.preventDefault();
            const amount = 48;
            body.current?.scrollBy?.({
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
        }}
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
          <ReportDrawingSize.Provider value={setDrawing}>
            {children}
          </ReportDrawingSize.Provider>
        </div>
        {table ? (
          <div hidden={tab !== "source"} className={styles["task-view__data"]}>
            {table}
            <details className={styles["task-view__technical"]}>
              <summary>Technical</summary>
              <pre className={styles["task-view__source"]}>
                <code>{source}</code>
              </pre>
            </details>
          </div>
        ) : (
          <pre
            hidden={tab !== "source"}
            className={styles["task-view__source"]}
          >
            <code>{source}</code>
          </pre>
        )}
      </div>
      {/*
        Only when it has something to say. A chart has no zoom and, until it is
        saved, nothing to report — an empty footer is then a bar of nothing
        ruled off under every chart in the conversation.
      */}
      {footerContent && (
        <footer className={styles["task-view__footer"]}>
          {showZoom && (
            <div
              className={styles["task-view__zoom"]}
              aria-label="Diagram zoom"
            >
              <button
                type="button"
                onClick={() => changeZoom(-1)}
                aria-label="Zoom out"
              >
                −
              </button>
              <span aria-live="polite">{zoom}%</span>
              <button
                type="button"
                onClick={() => changeZoom(1)}
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                className={styles["task-view__zoom-reset"]}
                onClick={() => setZoom(fit)}
                disabled={zoom === fit}
              >
                Fit
              </button>
            </div>
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
