import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

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

/**
 * The zoom of a drawing inside the frame that shows it: the size it opens at,
 * which is the largest readable one that fits, the steps a person takes from
 * there with the controls or the wheel, and whether the drawing has outgrown
 * the frame. The drawing reports its own size once it is drawn.
 */
export function useDrawingZoom(
  body: RefObject<HTMLDivElement | null>,
  zoomable: boolean,
  /** The drawing is what the frame shows, and not its source. */
  rendered: boolean,
) {
  /** Unset until a person zooms: the drawing opens at its fitting size. */
  const [chosenZoom, setZoom] = useState<number>();
  const [drawing, setDrawing] = useState<DrawingSize>();
  const [frame, setFrame] = useState<FrameSize>({ width: 0 });
  const fit = drawing ? fittingZoom(drawing, frame) : 100;
  const zoom = chosenZoom ?? Math.min(100, Math.max(fit, readableZoom));
  /** Below a quarter only when that is what it takes to see all of it. */
  const smallestZoom = Math.min(minimumZoom, fit);
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
  }, [body, zoomable, drawing]);

  /**
   * The wheel is registered by hand because React's wheel listener is passive,
   * and a passive listener cannot stop the page scrolling underneath. Zooming
   * a diagram while the thread slides away is not zooming.
   */
  useEffect(() => {
    const element = body.current;
    if (!element || !zoomable || !rendered) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      zoomFromWheel(event.deltaY < 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [body, zoomable, rendered]);

  return {
    drawing,
    /** Given to the drawing, which says what size it came out. */
    reportDrawing: setDrawing,
    zoom,
    fit,
    overflows,
    changeZoom,
    fitToFrame: () => setZoom(fit),
  };
}
