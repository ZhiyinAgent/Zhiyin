import { describe, expect, it } from "vitest";
import { placePopover } from "./placePopover.js";

const window = { width: 720, height: 480 };
/** A button 16 pixels square, its top-left corner at x, y. */
const button = (x: number, y: number) => ({
  top: y,
  bottom: y + 16,
  left: x,
  width: 16,
});

describe("where a popover opens", () => {
  it("opens on its own side when it fits there", () => {
    const place = placePopover(
      button(100, 100),
      { width: 200, height: 120 },
      window,
      { side: "below", gap: 6, edge: 8 },
    );

    expect(place).toMatchObject({ top: 122, left: 100, opens: "down" });
    expect(place.bottom).toBeUndefined();
  });

  it("opens on the other side when only that one has room", () => {
    const place = placePopover(
      button(100, 400),
      { width: 200, height: 120 },
      window,
      { side: "below", gap: 6, edge: 8 },
    );

    // Pinned to the button by its bottom edge: 480 - 400 + 6.
    expect(place).toMatchObject({ bottom: 86, opens: "up" });
    expect(place.top).toBeUndefined();
  });

  it("keeps a popover too tall for either side inside the window, scrolling", () => {
    const place = placePopover(
      button(100, 230),
      { width: 200, height: 300 },
      window,
      { side: "below", gap: 6, edge: 8 },
    );

    expect(place.top).toBe(480 - 8 - 300);
    expect(place.maxHeight).toBe(480 - 16);
  });

  it("is no taller than the room on its side", () => {
    const place = placePopover(
      button(100, 300),
      { width: 200, height: 100 },
      window,
      { side: "above", gap: 7, edge: 12 },
    );

    expect(place.maxHeight).toBe(300 - 7 - 12);
  });

  it("stays inside the window's width, starting where its anchor does", () => {
    const right = placePopover(
      button(690, 100),
      { width: 300, height: 50 },
      window,
      { side: "below", gap: 6, edge: 8 },
    );
    const left = placePopover(
      button(2, 100),
      { width: 300, height: 50 },
      window,
      { side: "below", gap: 6, edge: 8, inset: -12 },
    );

    expect(right.left).toBe(720 - 300 - 8);
    expect(left.left).toBe(8);
  });

  it("is at least as wide as asked, and as its anchor less what is asked, within the window", () => {
    const row = { top: 100, bottom: 139, left: 11, width: 400 };

    expect(
      placePopover(row, { width: 0, height: 0 }, window, {
        side: "below",
        gap: 4,
        edge: 8,
        anchorWidthLess: 14,
        leastWidth: 280,
      }).minWidth,
    ).toBe(386);
    expect(
      placePopover(
        row,
        { width: 0, height: 0 },
        { width: 200, height: 480 },
        { side: "below", gap: 4, edge: 8, leastWidth: 280 },
      ).minWidth,
    ).toBe(184);
  });

  it("can be placed by its top edge above its anchor", () => {
    const place = placePopover(
      button(100, 400),
      { width: 200, height: 120 },
      window,
      { side: "below", gap: 6, edge: 8, byTop: true },
    );

    expect(place).toMatchObject({ top: 400 - 6 - 120, opens: "up" });
    expect(place.bottom).toBeUndefined();
  });
});
