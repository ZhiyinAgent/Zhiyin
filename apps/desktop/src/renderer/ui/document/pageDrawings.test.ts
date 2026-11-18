import { describe, expect, it } from "vitest";
import {
  askedWidth,
  heldAcross,
  needsDrawing,
  standIn,
  wantedPages,
  withAnswer,
  withinBound,
  zoomedByWheel,
  zoomRange,
  type Drawing,
} from "./pageDrawings.js";

describe("zooming with the wheel", () => {
  it("goes a tenth in or out for a notch, and less for a pinch's small turns", () => {
    expect(zoomedByWheel(2, -100)).toBeCloseTo(2.2);
    expect(zoomedByWheel(2, 100)).toBeCloseTo(2 / 1.1);
    expect(zoomedByWheel(2, -1000)).toBeCloseTo(2.2);
    expect(zoomedByWheel(2, -5)).toBeGreaterThan(2);
    expect(zoomedByWheel(2, -5)).toBeLessThan(2.02);
  });

  it("stops at 100% when it would cross it, and never leaves its range", () => {
    expect(zoomedByWheel(0.95, -100)).toBe(1);
    expect(zoomedByWheel(1.05, 100)).toBe(1);
    // From 100% itself it moves on.
    expect(zoomedByWheel(1, -100)).toBeCloseTo(1.1);
    expect(zoomedByWheel(zoomRange.max, -100)).toBe(zoomRange.max);
    expect(zoomedByWheel(zoomRange.min, 100)).toBe(zoomRange.min);
  });
});

const letter = { width: 612, height: 792 };
const drawn = (width: number, data = "D"): Drawing => ({
  status: "drawn",
  width,
  data,
});
const failed = (attempts: number): Drawing => ({
  status: "failed",
  reason: "Timed out.",
  attempts,
});

describe("which pages are drawn", () => {
  it("are those in view, the one being read, and the next two the way the reader moves", () => {
    const visible = new Set([4, 5]);

    expect([
      ...wantedPages({ reading: 5, heading: 1, count: 10, visible }),
    ]).toEqual([4, 5, 6, 7]);
    expect([
      ...wantedPages({ reading: 5, heading: -1, count: 10, visible }),
    ]).toEqual([4, 5, 3]);
  });

  it("turns back at either end of the document", () => {
    const none = new Set<number>();

    expect([
      ...wantedPages({ reading: 1, heading: -1, count: 10, visible: none }),
    ]).toEqual([1, 2, 3]);
    expect([
      ...wantedPages({ reading: 10, heading: 1, count: 10, visible: none }),
    ]).toEqual([10, 9, 8]);
  });

  it("are asked for at their shown width in steps of 160 device pixels, never past 8192", () => {
    const panel = { width: 500, height: 800 };

    // 500 less 16 each side is 468 shown, 936 device pixels at twice the scale.
    expect(askedWidth(letter, "width", "fit", panel, 2)).toBe(960);
    expect(askedWidth({ width: 9000, height: 100 }, "width", 1, panel, 1)).toBe(
      8192,
    );
  });

  it("are asked for again only when narrower than wanted, and not while asked as wide", () => {
    expect(needsDrawing(undefined, 960, undefined)).toBe(true);
    expect(needsDrawing(drawn(960), 960, undefined)).toBe(false);
    expect(needsDrawing(drawn(800), 960, undefined)).toBe(true);
    expect(needsDrawing(undefined, 960, 960)).toBe(false);
    expect(needsDrawing(undefined, 960, 800)).toBe(true);
  });

  it("are asked for twice before a page is said to be undrawable", () => {
    expect(needsDrawing(failed(1), 960, undefined)).toBe(true);
    expect(needsDrawing(failed(2), 960, undefined)).toBe(false);
  });
});

describe("which drawings are kept", () => {
  const none = new Set<number>();

  it("counts each failure to draw a page", () => {
    const once = withAnswer(
      { revision: "r1", pages: {} },
      {
        revision: "r1",
        page: 3,
        width: 960,
        answer: { ok: false, reason: "No." },
      },
      none,
      3,
    );
    const twice = withAnswer(
      once,
      {
        revision: "r1",
        page: 3,
        width: 960,
        answer: { ok: false, reason: "No." },
      },
      none,
      3,
    );

    expect(twice.pages[3]).toEqual({
      status: "failed",
      reason: "No.",
      attempts: 2,
    });
  });

  it("keeps a wider drawing that arrived first over a narrower one", () => {
    const before = { revision: "r1", pages: { 1: drawn(1280, "wide") } };

    expect(
      withAnswer(
        before,
        {
          revision: "r1",
          page: 1,
          width: 960,
          answer: { ok: true, data: "narrow", width: 960, height: 1242 },
        },
        none,
        1,
      ),
    ).toBe(before);
  });

  it("starts afresh for a new version of the document", () => {
    const after = withAnswer(
      { revision: "r1", pages: { 1: drawn(960), 2: drawn(960) } },
      {
        revision: "r2",
        page: 2,
        width: 960,
        answer: { ok: true, data: "new", width: 960, height: 1242 },
      },
      none,
      2,
    );

    expect(after).toEqual({
      revision: "r2",
      pages: { 2: { status: "drawn", width: 960, data: "new" } },
    });
  });

  it("lets go of the drawn pages farthest from the one being read once past the bound", () => {
    const pages = {
      1: drawn(960, "aaaa"),
      2: drawn(960, "bbbb"),
      5: drawn(960, "cccc"),
      9: drawn(960, "dddd"),
    };

    expect(Object.keys(withinBound(pages, none, 2, 12))).toEqual([
      "1",
      "2",
      "5",
    ]);
  });

  it("never lets go of a wanted page, however far it is", () => {
    const pages = { 1: drawn(960, "aaaa"), 9: drawn(960, "dddd") };

    expect(Object.keys(withinBound(pages, new Set([9]), 1, 4))).toEqual(["9"]);
  });

  it("keeps the same drawings while they fit", () => {
    const pages = { 1: drawn(960, "aaaa") };

    expect(withinBound(pages, none, 1, 4)).toBe(pages);
  });
});

describe("drawings of an earlier version", () => {
  it("are held with their page's size when a new version arrives", () => {
    const earlier = heldAcross(
      { revision: "r1", sizes: [letter, letter], held: {} },
      { revision: "r1", pages: { 1: drawn(960, "one"), 2: failed(2) } },
      { revision: "r2", pages: [letter] },
    );

    expect(earlier).toEqual({
      revision: "r2",
      sizes: [letter],
      held: { 1: { data: "one", ...letter } },
    });
  });

  it("stand in for a page of the same size until its own drawing arrives", () => {
    const before = { data: "old", ...letter };

    expect(standIn(undefined, before, letter)).toBe("old");
    expect(standIn(failed(1), before, letter)).toBe("old");
    expect(standIn(drawn(960), before, letter)).toBeUndefined();
    expect(
      standIn(undefined, before, { width: 792, height: 612 }),
    ).toBeUndefined();
  });
});
