import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { DocumentPageDrawing, DocumentPanelState } from "@zhiyin/contract";
import {
  gutter,
  shownState,
  shownWidth,
  standIn,
  zoomedByWheel,
  type Drawing,
  type Fit,
  type Zoom,
} from "./pageDrawings.js";
import { usePageDrawings } from "./usePageDrawings.js";
import styles from "./document.module.css";

/** What the engine draws of a document: its name, revision and pages. */
type Paged = Pick<
  Extract<DocumentPanelState, { status: "shown"; kind: "pdf" | "picture" }>,
  "name" | "revision" | "pages"
>;

/** A move to a page the reader did not scroll to: pointed at, or keyed. */
export type Jump = {
  readonly id: number;
  readonly page: number;
  readonly smooth: boolean;
};

/** How long the width must hold still before sharper pages are asked for. */
const settleMs = 150;
/**
 * A change of width the panel does not ask for: below a scrollbar's width, so
 * a scrollbar coming and going cannot set the space rocking.
 */
const smallestAsk = 12;

/**
 * The engine both a document's pages and a picture are drawn with: the pages
 * in a vertical scroll. Each page keeps its place at its own
 * proportions before it is drawn; only the page on screen, those about to
 * be, and the one after are asked of the core, at the width they are shown.
 */
export function DocumentPages({
  document,
  fit,
  zoom,
  onZoom,
  page,
  jump,
  onRead,
  onJump,
  drawPage,
  fitHeight,
  onDrawn,
}: {
  document: Paged;
  fit: Fit;
  zoom: Zoom;
  /** The reader zoomed with Ctrl and the wheel. */
  onZoom?: ((zoom: Zoom) => void) | undefined;
  /** The page being read. */
  page: number;
  jump: Jump | undefined;
  /** The reader scrolled to another page. */
  onRead: (page: number) => void;
  /** The reader asked for another page. */
  onJump: (page: number) => void;
  drawPage: (
    revision: string,
    page: number,
    width: number,
  ) => Promise<DocumentPageDrawing>;
  /**
   * The page proportions to fit to the panel's height, and where to ask for
   * the width that takes.
   */
  fitHeight?:
    | {
        readonly aspect: number;
        readonly ask: (change: number) => void;
      }
    | undefined;
  /** The page being read is drawn, or said to be undrawable. */
  onDrawn?: (() => void) | undefined;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const figures = useRef<(HTMLElement | null)[]>([]);
  const [available, setAvailable] = useState(0);
  const [height, setHeight] = useState(0);
  /**
   * The size pages are drawn for: the panel's, once it holds still. Nothing
   * is drawn before the panel has measured itself, so no page is drawn at a
   * width it is not shown at.
   */
  const [settled, setSettled] = useState<{ width: number; height: number }>();
  const measuredWidth = useRef<number>(undefined);
  /** Where the reader was, held across a change of width. */
  const anchor = useRef<{ page: number; into: number }>(undefined);
  const reading = useRef(1);
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set());
  const count = document.pages.length;
  const current = Math.min(Math.max(1, page), count);
  useLayoutEffect(() => {
    reading.current = current;
  }, [current]);
  // A page of a new version that is not drawn yet shows its last drawing at
  // the same size, rather than an empty page, until its own is drawn.
  const { pages, held } = usePageDrawings({
    document,
    fit,
    zoom,
    reading: current,
    visible,
    settled,
    drawPage,
  });
  const reached = shownState(pages[current]);
  useEffect(() => {
    if (reached !== "waiting") onDrawn?.();
  }, [reached, onDrawn, document.revision]);

  // The panel's width, as the divider and the window change it.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      // Before the pages take their new size, note how far into the page
      // being read the top of the panel is, to put it back there after.
      const figure = figures.current[reading.current - 1];
      if (figure && width !== measuredWidth.current) {
        const box = figure.getBoundingClientRect();
        if (box.height)
          anchor.current = {
            page: reading.current,
            into: (element.getBoundingClientRect().top - box.top) / box.height,
          };
      }
      measuredWidth.current = width;
      setAvailable(width);
      setHeight(element.clientHeight);
      setSettled((before) => before ?? { width, height: element.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Ctrl with the wheel, or a pinch on a touchpad, zooms from the scale the
  // pages are shown at. The listener is not passive: the window's own zoom
  // must not take the turn.
  useEffect(() => {
    const element = viewport.current;
    if (!element || !onZoom) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      const number = reading.current;
      const size = document.pages[number - 1];
      if (!size) return;
      const figure = figures.current[number - 1];
      const box = figure?.getBoundingClientRect();
      if (box?.height)
        anchor.current = {
          page: number,
          into: (element.getBoundingClientRect().top - box.top) / box.height,
        };
      const shown = shownWidth(size, fit, zoom, available, height);
      onZoom(zoomedByWheel(shown / size.width, event.deltaY));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onZoom, document.pages, fit, zoom, available, height]);

  // The page being read stays where it was within the panel.
  useLayoutEffect(() => {
    const element = viewport.current;
    const held = anchor.current;
    anchor.current = undefined;
    const figure = held && figures.current[held.page - 1];
    if (!element || !held || !figure) return;
    const box = figure.getBoundingClientRect();
    element.scrollTop +=
      box.top - element.getBoundingClientRect().top + held.into * box.height;
  }, [available, zoom]);

  // Sharper pages wait until the size holds still; the first size is used
  // at once, so the first pages are not held back.
  useEffect(() => {
    if (
      settled === undefined ||
      (settled.width === available && settled.height === height)
    )
      return;
    const timer = setTimeout(
      () => setSettled({ width: available, height }),
      settleMs,
    );
    return () => clearTimeout(timer);
  }, [available, height, settled]);

  // A portrait page at fit-width fills the panel's height: ask for the width
  // that takes. At 100% the person chose the size, so nothing is asked.
  const ask = fitHeight?.ask;
  const aspect = fitHeight?.aspect;
  useEffect(() => {
    if (!ask || !aspect || zoom !== "fit" || !available || !height) return;
    const change = (height - 2 * gutter) * aspect + 2 * gutter - available;
    if (Math.abs(change) >= smallestAsk) ask(change);
  }, [ask, aspect, zoom, available, height]);

  // Which pages are on screen, or about to be.
  useEffect(() => {
    const root = viewport.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) =>
        setVisible((before) => {
          const next = new Set(before);
          for (const entry of entries) {
            const number = Number(
              (entry.target as HTMLElement).dataset["page"],
            );
            if (entry.isIntersecting) next.add(number);
            else next.delete(number);
          }
          return next;
        }),
      { root, rootMargin: "50% 0px" },
    );
    for (const figure of figures.current) if (figure) observer.observe(figure);
    return () => observer.disconnect();
  }, [count]);

  // A page asked for is scrolled to; one scrolled to needs nothing. Only the
  // pages move: scrolling the page into view would scroll every ancestor too,
  // and take the panel's bar out of the window.
  useEffect(() => {
    const element = viewport.current;
    const figure = jump && figures.current[jump.page - 1];
    if (!element || !figure) return;
    element.scrollTo({
      top:
        element.scrollTop +
        figure.getBoundingClientRect().top -
        element.getBoundingClientRect().top,
      behavior: jump.smooth ? "smooth" : "auto",
    });
  }, [jump]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target =
      event.key === "PageDown"
        ? current + 1
        : event.key === "PageUp"
          ? current - 1
          : event.key === "Home"
            ? 1
            : event.key === "End"
              ? count
              : undefined;
    if (target === undefined) return;
    event.preventDefault();
    onJump(Math.min(Math.max(1, target), count));
  }

  function onScroll() {
    const element = viewport.current;
    if (!element) return;
    let reading = 1;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 2)
      reading = count;
    else {
      // Measured against the viewport itself: a page's offset is from
      // whichever ancestor is positioned, which is not this one.
      const line =
        element.getBoundingClientRect().top + element.clientHeight * 0.3;
      figures.current.forEach((figure, index) => {
        if (figure && figure.getBoundingClientRect().top <= line)
          reading = index + 1;
      });
    }
    if (reading !== current) onRead(reading);
  }

  return (
    <div
      ref={viewport}
      className={styles["document-panel__viewport"]}
      role="region"
      aria-label={`Pages of ${document.name}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      // A page's own `draggable` does not hold once a selection holds it, and
      // a selection drags its pictures with it.
      onDragStart={(event) => event.preventDefault()}
    >
      {document.pages.map((size, index) => {
        const number = index + 1;
        const width = shownWidth(size, fit, zoom, available, height);
        const drawing: Drawing | undefined = pages[number];
        const stand = standIn(drawing, held[number], size);
        // A picture seen whole is named by itself, not as a page.
        const picture = fit === "whole";
        return (
          <figure
            key={number}
            ref={(element) => {
              figures.current[index] = element;
            }}
            className={styles["document-panel__page"]}
            role="group"
            aria-label={picture ? document.name : `Page ${number}`}
            data-page={number}
            data-state={stand ? "drawn" : shownState(drawing)}
            style={{
              width: `${width}px`,
              height: `${Math.round((width * size.height) / size.width)}px`,
            }}
          >
            {drawing?.status === "drawn" || stand ? (
              <img
                src={drawing?.status === "drawn" ? drawing.data : stand}
                alt={
                  picture ? document.name : `Page ${number} of ${document.name}`
                }
                draggable={false}
              />
            ) : shownState(drawing) === "failed" ? (
              <p>{drawing?.status === "failed" && drawing.reason}</p>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}
