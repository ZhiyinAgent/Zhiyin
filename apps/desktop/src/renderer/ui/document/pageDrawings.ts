import type { DocumentPageDrawing, DocumentPageSize } from "@zhiyin/contract";

/**
 * How a page is fitted to the panel: to its width, as a document's pages are
 * read, or whole, as a picture is seen, never blown up past its own pixels.
 */
export type Fit = "width" | "whole";

/**
 * Fitted to the panel, or a multiple of the file's own size: 1 is 100%, and
 * Ctrl with the wheel moves it in steps between `zoomRange`.
 */
export type Zoom = "fit" | number;

export const zoomRange = { min: 0.25, max: 4 } as const;
/** How much a notch of a mouse wheel (100 units) changes a zoom. */
const zoomStep = 1.1;
/** A touchpad's pinch sends many small turns; no turn counts for more than a notch. */
const notch = 100;

/**
 * The zoom a turn of the wheel with Ctrl leads to, from the scale pages are
 * shown at now (a fitted page's too): in for a wheel turned away from the
 * reader, a notch by a tenth, a pinch by what it sends. Crossing 100% stops
 * there, so the file's own size is easy to reach.
 */
export function zoomedByWheel(shownScale: number, deltaY: number): number {
  const factor = zoomStep ** (Math.min(Math.abs(deltaY), notch) / notch);
  const next = Math.min(
    zoomRange.max,
    Math.max(
      zoomRange.min,
      deltaY < 0 ? shownScale * factor : shownScale / factor,
    ),
  );
  return (shownScale - 1) * (next - 1) < 0 ? 1 : next;
}

/** What the core answered for one page. */
export type Drawing =
  | { readonly status: "drawn"; readonly width: number; readonly data: string }
  | {
      readonly status: "failed";
      readonly reason: string;
      /** How many times it was asked for and not drawn. */
      readonly attempts: number;
    };

/** The drawings of one version of a document, by page number. */
export type Drawings = {
  readonly revision: string;
  readonly pages: Readonly<Record<number, Drawing>>;
};

/** The drawings of the versions before, by page, each with its page's size. */
export type Earlier = {
  readonly revision: string;
  readonly sizes: readonly DocumentPageSize[];
  readonly held: Readonly<
    Record<number, { readonly data: string } & DocumentPageSize>
  >;
};

/**
 * A page is asked for twice before it is said to be undrawable, so one that
 * ran out of time once, on a busy machine say, is drawn the second time.
 */
const attemptsPerPage = 2;
/**
 * How much of their drawings pages kept drawn may hold, in characters of
 * their data, the nearest to the page being read first, as the core keeps its
 * own: about 64 MB, room for many pages at a panel's width. More only while
 * more are wanted; the rest are drawn again when they come back.
 */
const keptCharacters = 64 * 1024 * 1024;
/** Pages drawn ahead of the one being read, in the direction the reader moves. */
const drawnAhead = 2;
/**
 * Pages are asked for in widths of this many device pixels, so dragging the
 * divider a little does not draw every page again.
 */
const widthStep = 160;
/** No page is asked for wider than the core draws one. */
const widestDrawing = 8192;
/** The space around the pages, each side, in CSS pixels. */
export const gutter = 16;

/** How wide a page is shown, in CSS pixels. */
export function shownWidth(
  size: DocumentPageSize,
  fit: Fit,
  zoom: Zoom,
  available: number,
  height: number,
): number {
  if (zoom !== "fit") return size.width * zoom;
  if (available <= 0) return size.width;
  const room = Math.max(120, available - 2 * gutter);
  if (fit === "width") return room;
  const tall =
    height > 0 && size.height > 0
      ? (Math.max(120, height - 2 * gutter) * size.width) / size.height
      : room;
  return Math.min(size.width, room, tall);
}

/** A page asked for again after a failure shows as waiting until it answers. */
export function shownState(
  drawing: Drawing | undefined,
): "drawn" | "failed" | "waiting" {
  if (!drawing) return "waiting";
  if (drawing.status === "drawn") return "drawn";
  return drawing.attempts >= attemptsPerPage ? "failed" : "waiting";
}

/**
 * The pages to have drawn: those on screen or about to be, the one being
 * read, and the next few the way the reader moves. At the first or last page
 * the only way on is back the other way.
 */
export function wantedPages({
  reading,
  heading,
  count,
  visible,
}: {
  reading: number;
  heading: 1 | -1;
  count: number;
  visible: ReadonlySet<number>;
}): ReadonlySet<number> {
  const way =
    reading + heading < 1 || reading + heading > count ? -heading : heading;
  const ahead = Array.from(
    { length: drawnAhead },
    (_, step) => reading + (step + 1) * way,
  ).filter((number) => number >= 1 && number <= count);
  return new Set([...visible, reading, ...ahead]);
}

/**
 * The width to ask a page for, in device pixels: as wide as it is shown, in
 * steps, and no wider than the core draws.
 */
export function askedWidth(
  size: DocumentPageSize,
  fit: Fit,
  zoom: Zoom,
  panel: { readonly width: number; readonly height: number },
  scale: number,
): number {
  return Math.min(
    widestDrawing,
    Math.ceil(
      (shownWidth(size, fit, zoom, panel.width, panel.height) * scale) /
        widthStep,
    ) * widthStep,
  );
}

/**
 * Whether a page is asked for at this width: not once it failed every
 * attempt, nor while it is drawn or asked for as wide.
 */
export function needsDrawing(
  drawing: Drawing | undefined,
  width: number,
  asking: number | undefined,
): boolean {
  if (drawing?.status === "failed" && drawing.attempts >= attemptsPerPage)
    return false;
  if (drawing?.status === "drawn" && drawing.width >= width) return false;
  return (asking ?? 0) < width;
}

/**
 * The drawings once the core answered for one page: a failure counts an
 * attempt, a wider drawing that arrived first is kept over a narrower one,
 * and drawings past the bound are let go.
 */
export function withAnswer(
  before: Drawings,
  answered: {
    readonly revision: string;
    readonly page: number;
    readonly width: number;
    readonly answer: DocumentPageDrawing;
  },
  wanted: ReadonlySet<number>,
  reading: number,
): Drawings {
  const { revision, page, width, answer } = answered;
  const kept = before.revision === revision ? before.pages : {};
  const already = kept[page];
  if (answer.ok && already?.status === "drawn" && already.width > width)
    return before;
  return {
    revision,
    pages: withinBound(
      {
        ...kept,
        [page]: answer.ok
          ? { status: "drawn", width, data: answer.data }
          : {
              status: "failed",
              reason: answer.reason,
              attempts:
                (already?.status === "failed" ? already.attempts : 0) + 1,
            },
      },
      new Set([...wanted, page]),
      reading,
    ),
  };
}

/**
 * The drawings with those past the bound let go: the drawn pages farthest
 * from the page being read, never one that is wanted.
 */
export function withinBound(
  pages: Readonly<Record<number, Drawing>>,
  wanted: ReadonlySet<number>,
  reading: number,
  bound = keptCharacters,
): Readonly<Record<number, Drawing>> {
  const drawn = Object.entries(pages).flatMap(([number, drawing]) =>
    drawing.status === "drawn"
      ? [{ number: Number(number), size: drawing.data.length }]
      : [],
  );
  let held = drawn
    .filter(({ number }) => wanted.has(number))
    .reduce((total, { size }) => total + size, 0);
  const farthest = new Set<number>();
  for (const { number, size } of drawn
    .filter(({ number }) => !wanted.has(number))
    .sort(
      (a, b) => Math.abs(a.number - reading) - Math.abs(b.number - reading),
    )) {
    held += size;
    if (held > bound) farthest.add(number);
  }
  if (!farthest.size) return pages;
  return Object.fromEntries(
    Object.entries(pages).filter(([number]) => !farthest.has(Number(number))),
  );
}

/**
 * What is held from earlier versions once a new one arrives: the pages the
 * last version had drawn join those held before, each with its size.
 */
export function heldAcross(
  earlier: Earlier,
  drawings: Drawings,
  next: {
    readonly revision: string;
    readonly pages: readonly DocumentPageSize[];
  },
): Earlier {
  const held = { ...earlier.held };
  if (drawings.revision === earlier.revision)
    for (const [number, drawing] of Object.entries(drawings.pages)) {
      const size = earlier.sizes[Number(number) - 1];
      if (drawing.status === "drawn" && size)
        held[Number(number)] = { data: drawing.data, ...size };
    }
  return { revision: next.revision, sizes: next.pages, held };
}

/**
 * What stands in for a page of a new version not drawn yet: its last drawing,
 * when the page is still the same size.
 */
export function standIn(
  drawing: Drawing | undefined,
  before: ({ readonly data: string } & DocumentPageSize) | undefined,
  size: DocumentPageSize,
): string | undefined {
  return shownState(drawing) === "waiting" &&
    before?.width === size.width &&
    before.height === size.height
    ? before.data
    : undefined;
}
