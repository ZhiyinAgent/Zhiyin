import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DocumentPageDrawing, DocumentPageSize } from "@zhiyin/contract";
import {
  askedWidth,
  heldAcross,
  needsDrawing,
  wantedPages,
  withAnswer,
  type Drawing,
  type Drawings,
  type Earlier,
  type Fit,
  type Zoom,
} from "./pageDrawings.js";

/**
 * The drawings of a document's pages, asked of the core as they are wanted:
 * the page being read, those on screen or about to be, and the next few the
 * way the reader moves, at the width they are shown once the panel holds
 * still. Also the drawings of earlier versions, which stand in for a page of
 * a new version until its own is drawn.
 */
export function usePageDrawings({
  document,
  fit,
  zoom,
  reading,
  visible,
  settled,
  drawPage,
}: {
  document: {
    readonly revision: string;
    readonly pages: readonly DocumentPageSize[];
  };
  fit: Fit;
  zoom: Zoom;
  /** The page being read. */
  reading: number;
  /** The pages on screen or about to be. */
  visible: ReadonlySet<number>;
  /** The panel's size once it holds still; nothing is drawn before. */
  settled: { readonly width: number; readonly height: number } | undefined;
  drawPage: (
    revision: string,
    page: number,
    width: number,
  ) => Promise<DocumentPageDrawing>;
}): {
  /** This version's drawings, by page. */
  pages: Readonly<Record<number, Drawing>>;
  held: Earlier["held"];
} {
  const count = document.pages.length;
  const last = useRef(reading);
  /** The way the reader last moved: on through the pages, or back. */
  const heading = useRef<1 | -1>(1);
  useLayoutEffect(() => {
    if (reading !== last.current)
      heading.current = reading > last.current ? 1 : -1;
    last.current = reading;
  }, [reading]);
  const [drawings, setDrawings] = useState<Drawings>({
    revision: document.revision,
    pages: {},
  });
  /** The pages wanted at the last drawing pass, kept when others go. */
  const wantedNow = useRef<ReadonlySet<number>>(new Set());
  /** Widths asked for and not yet answered, by revision and page. */
  const asked = useRef(new Map<string, number>());
  const pages = drawings.revision === document.revision ? drawings.pages : {};
  const [earlier, setEarlier] = useState<Earlier>({
    revision: document.revision,
    sizes: document.pages,
    held: {},
  });
  if (earlier.revision !== document.revision)
    setEarlier(heldAcross(earlier, drawings, document));

  // Draw what is wanted and not drawn wide enough yet.
  useEffect(() => {
    if (settled === undefined) return;
    const { revision } = document;
    const drawn = drawings.revision === revision ? drawings.pages : {};
    const scale = window.devicePixelRatio || 1;
    const wanted = wantedPages({
      reading,
      heading: heading.current,
      count,
      visible,
    });
    wantedNow.current = wanted;
    for (const number of wanted) {
      const size = document.pages[number - 1];
      if (!size) continue;
      const width = askedWidth(size, fit, zoom, settled, scale);
      const key = `${revision}:${number}`;
      if (!needsDrawing(drawn[number], width, asked.current.get(key))) continue;
      asked.current.set(key, width);
      void drawPage(revision, number, width)
        .catch((): DocumentPageDrawing => ({
          ok: false,
          reason: `Page ${number} could not be drawn.`,
        }))
        .then((answer) => {
          if (asked.current.get(key) === width) asked.current.delete(key);
          setDrawings((before) =>
            withAnswer(
              before,
              { revision, page: number, width, answer },
              wantedNow.current,
              last.current,
            ),
          );
        });
    }
  }, [
    document,
    fit,
    visible,
    reading,
    count,
    zoom,
    settled,
    drawings,
    drawPage,
  ]);

  return { pages, held: earlier.held };
}
