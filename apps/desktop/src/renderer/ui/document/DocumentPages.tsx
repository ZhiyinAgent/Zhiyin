import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  DocumentPageDrawing,
  DocumentPageSize,
  DocumentPanelState,
} from "@zhiyin/contract";
import styles from "./document.module.css";

type Shown = Extract<DocumentPanelState, { status: "shown" }>;

export type Zoom = "fit" | "actual";

/** A move to a page the reader did not scroll to: pointed at, or keyed. */
export type Jump = {
  readonly id: number;
  readonly page: number;
  readonly smooth: boolean;
};

type Drawing =
  | { readonly status: "drawn"; readonly width: number; readonly data: string }
  | { readonly status: "failed"; readonly reason: string };

/**
 * Pages are asked for in widths of this many device pixels, so dragging the
 * divider a little does not draw every page again.
 */
const widthStep = 160;
/** The space around the pages, each side, in CSS pixels. */
const gutter = 16;
/** No page is asked for wider than the core draws one. */
const widestDrawing = 8192;
/** How long the width must hold still before sharper pages are asked for. */
const settleMs = 150;
/**
 * A change of width the panel does not ask for: below a scrollbar's width, so
 * a scrollbar coming and going cannot set the space rocking.
 */
const smallestAsk = 12;

/** How wide a page is shown, in CSS pixels. */
function shownWidth(
  size: DocumentPageSize,
  kind: Shown["kind"],
  zoom: Zoom,
  available: number,
): number {
  if (zoom === "actual" || available <= 0) return size.width;
  const room = Math.max(120, available - 2 * gutter);
  // A picture is never blown up past its own pixels; a page fills the width.
  return kind === "picture" ? Math.min(size.width, room) : room;
}

/**
 * The pages in a vertical scroll. Each page keeps its place at its own
 * proportions before it is drawn; only the page on screen, those about to
 * be, and the one after are asked of the core, at the width they are shown.
 */
export function DocumentPages({
  document,
  zoom,
  page,
  jump,
  onRead,
  onJump,
  drawPage,
  fitHeight,
}: {
  document: Shown;
  zoom: Zoom;
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
  fitHeight?: {
    readonly aspect: number;
    readonly ask: (change: number) => void;
  };
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const figures = useRef<(HTMLElement | null)[]>([]);
  const [available, setAvailable] = useState(0);
  const [height, setHeight] = useState(0);
  /**
   * The width pages are drawn for: the panel's, once it holds still. Nothing
   * is drawn before the panel has measured itself, so no page is drawn at a
   * width it is not shown at.
   */
  const [settled, setSettled] = useState<number>();
  const measuredWidth = useRef<number>(undefined);
  /** Where the reader was, held across a change of width. */
  const anchor = useRef<{ page: number; into: number }>(undefined);
  const reading = useRef(1);
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set());
  const [drawings, setDrawings] = useState<{
    readonly revision: string;
    readonly pages: Readonly<Record<number, Drawing>>;
  }>({ revision: document.revision, pages: {} });
  /** Widths asked for and not yet answered, by revision and page. */
  const asked = useRef(new Map<string, number>());
  const count = document.pages.length;
  const current = Math.min(Math.max(1, page), count);
  useLayoutEffect(() => {
    reading.current = current;
  }, [current]);
  const pages = drawings.revision === document.revision ? drawings.pages : {};

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
      setSettled((before) => before ?? width);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
  }, [available]);

  // Sharper pages wait until the width holds still; the first width is used
  // at once, so the first pages are not held back.
  useEffect(() => {
    if (settled === undefined || settled === available) return;
    const timer = setTimeout(() => setSettled(available), settleMs);
    return () => clearTimeout(timer);
  }, [available, settled]);

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

  // Draw what is wanted and not drawn wide enough yet.
  useEffect(() => {
    if (settled === undefined) return;
    const { revision, kind } = document;
    const drawn = drawings.revision === revision ? drawings.pages : {};
    const scale = window.devicePixelRatio || 1;
    const wanted = new Set([...visible, current, Math.min(current + 1, count)]);
    for (const number of wanted) {
      const size = document.pages[number - 1];
      if (!size) continue;
      const width = Math.min(
        widestDrawing,
        Math.ceil((shownWidth(size, kind, zoom, settled) * scale) / widthStep) *
          widthStep,
      );
      const drawing = drawn[number];
      const key = `${revision}:${number}`;
      if (drawing?.status === "failed") continue;
      if (drawing && drawing.width >= width) continue;
      if ((asked.current.get(key) ?? 0) >= width) continue;
      asked.current.set(key, width);
      void drawPage(revision, number, width)
        .catch((): DocumentPageDrawing => ({
          ok: false,
          reason: `Page ${number} could not be drawn.`,
        }))
        .then((answer) => {
          if (asked.current.get(key) === width) asked.current.delete(key);
          setDrawings((before) => {
            const kept = before.revision === revision ? before.pages : {};
            const already = kept[number];
            // A wider drawing that arrived first is kept over a narrower one.
            if (
              answer.ok &&
              already?.status === "drawn" &&
              already.width > width
            )
              return before;
            return {
              revision,
              pages: {
                ...kept,
                [number]: answer.ok
                  ? { status: "drawn", width, data: answer.data }
                  : { status: "failed", reason: answer.reason },
              },
            };
          });
        });
    }
  }, [document, visible, current, count, zoom, settled, drawings, drawPage]);

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
        const width = shownWidth(size, document.kind, zoom, available);
        const drawing = pages[number];
        const picture = document.kind === "picture";
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
            data-state={drawing?.status ?? "waiting"}
            style={{
              width: `${width}px`,
              height: `${Math.round((width * size.height) / size.width)}px`,
            }}
          >
            {drawing?.status === "drawn" ? (
              <img
                src={drawing.data}
                alt={
                  picture ? document.name : `Page ${number} of ${document.name}`
                }
                draggable={false}
              />
            ) : drawing?.status === "failed" ? (
              <p>{drawing.reason}</p>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}
