import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ArtifactExport } from "@zhiyin/contract";
import styles from "./views.module.css";

/**
 * Far enough out to see a whole large diagram, far enough in to read a label
 * on one. Steps are round numbers so the readout stays a number a person can
 * hold on to rather than drifting to 103%.
 */
const minimumZoom = 25;
const maximumZoom = 400;
const buttonStep = 10;
const wheelStep = 10;

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
  onSave,
}: {
  title: string;
  kind: string;
  source: string;
  children: ReactNode;
  zoomable?: boolean;
  onSave?: (svg: string) => Promise<ArtifactExport>;
}) {
  const [tab, setTab] = useState<"rendered" | "source">("rendered");
  const [zoom, setZoom] = useState(100);
  const [status, setStatus] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const sourceLabel = kind === "diagram" ? "Source" : "Data";
  const showZoom = zoomable && tab === "rendered";
  const footerContent = showZoom || Boolean(status);
  const changeZoom = useCallback(
    (amount: number) =>
      setZoom((value) =>
        Math.min(maximumZoom, Math.max(minimumZoom, value + amount)),
      ),
    [],
  );

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
      changeZoom(event.deltaY < 0 ? wheelStep : -wheelStep);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomable, tab, changeZoom]);

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
            changeZoom(buttonStep);
          } else if (event.key === "-") {
            event.preventDefault();
            changeZoom(-buttonStep);
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
           * The drawing inside follows this width — once the caps that used to
           * pin it to its resting size are off, which is what the zoomable
           * class turns off.
           */
          style={zoomable ? { width: `${zoom}%` } : undefined}
        >
          {children}
        </div>
        <pre hidden={tab !== "source"} className={styles["task-view__source"]}>
          <code>{source}</code>
        </pre>
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
                onClick={() => changeZoom(-buttonStep)}
                aria-label="Zoom out"
              >
                −
              </button>
              <span aria-live="polite">{zoom}%</span>
              <button
                type="button"
                onClick={() => changeZoom(buttonStep)}
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                className={styles["task-view__zoom-reset"]}
                onClick={() => setZoom(100)}
                disabled={zoom === 100}
              >
                Fit
              </button>
            </div>
          )}
          {status && <span role="status">{status}</span>}
        </footer>
      )}
    </section>
  );
}
