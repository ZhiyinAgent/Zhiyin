/** Where a popover is held against what opened it. */
export type PopoverPlacement = {
  /** The side it opens on when it fits there, or when the other has no room. */
  readonly side: "above" | "below";
  /** Between it and its anchor, in pixels. */
  readonly gap: number;
  /** Kept between it and the window's edges, in pixels. */
  readonly edge: number;
  /** How far right of the anchor's left edge its own left edge starts. */
  readonly inset?: number;
  /** At least as wide as the anchor, less this many pixels. */
  readonly anchorWidthLess?: number;
  /** At least this wide, in pixels. */
  readonly leastWidth?: number;
  /**
   * Placed by its top edge above its anchor too, rather than pinned to the
   * anchor by its bottom edge: for one whose height is final once drawn.
   */
  readonly byTop?: boolean;
};

type Box = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
};

/** What a popover's style is set to, and which way it unrolls. */
export type PopoverPlace = {
  readonly top?: number;
  readonly bottom?: number;
  readonly left: number;
  readonly minWidth?: number;
  /** No taller than the room it has, so a long one scrolls inside itself. */
  readonly maxHeight: number;
  readonly opens: "up" | "down";
};

/**
 * Places a popover of the size it measured at against its anchor: on its own
 * side when it fits there, on the other when only that one has room, and when
 * neither has, as near its own side as the window lets it, over the anchor if
 * it must. Above, its bottom edge is pinned to the anchor, so it stays there
 * however tall it turns out to be. It is always inside the window.
 */
export function placePopover(
  anchor: Box,
  size: { readonly width: number; readonly height: number },
  window: { readonly width: number; readonly height: number },
  placement: PopoverPlacement,
): PopoverPlace {
  const { gap, edge } = placement;
  const room = {
    above: anchor.top - gap - edge,
    below: window.height - anchor.bottom - gap - edge,
  };
  const fits = (side: "above" | "below") => size.height <= room[side];
  const other = placement.side === "above" ? "below" : "above";
  const side = !fits(placement.side) && fits(other) ? other : placement.side;
  /** How far from its edge of the window it may start and still fit. */
  const furthest = window.height - edge - size.height;
  const least = Math.max(
    placement.leastWidth ?? 0,
    placement.anchorWidthLess === undefined
      ? 0
      : anchor.width - placement.anchorWidthLess,
  );
  const minWidth =
    least > 0 ? Math.min(least, window.width - edge * 2) : undefined;
  const width = Math.max(size.width, minWidth ?? 0);
  const left = Math.max(
    edge,
    Math.min(anchor.left + (placement.inset ?? 0), window.width - width - edge),
  );
  const inside = (offset: number) => Math.max(edge, Math.min(offset, furthest));
  return {
    ...(side === "below"
      ? { top: inside(anchor.bottom + gap) }
      : placement.byTop
        ? {
            top:
              window.height -
              inside(window.height - anchor.top + gap) -
              size.height,
          }
        : { bottom: inside(window.height - anchor.top + gap) }),
    left,
    ...(minWidth === undefined ? {} : { minWidth }),
    maxHeight: fits(side) ? room[side] : window.height - edge * 2,
    opens: side === "above" ? "up" : "down",
  };
}
