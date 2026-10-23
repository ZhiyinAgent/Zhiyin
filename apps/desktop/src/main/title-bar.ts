/**
 * The window's own title bar, drawn by the app rather than by Windows.
 *
 * Windows keeps drawing the three controls — minimize, maximize, close — so
 * Snap Layouts, the maximize hover flyout, the system menu and the hit-target
 * sizes all stay the ones a person already knows. What the app takes over is
 * the bar they sit on, which is the app's own top bar and not a strip above
 * it. The bar is part of the page's ground, grained and shaded, so the
 * controls are drawn on nothing of their own: the page shows through under
 * them, and a dialog's scrim with it. Their symbols are the app's soft text
 * colour, and the window's ground before the page paints is the app's ground.
 * These are written out because the main process cannot read a stylesheet,
 * and a test holds them to the tokens so a re-theme cannot leave the controls
 * on last season's colours.
 */
export const TITLE_BAR = {
  /** `--zy-canvas` and `--zy-text-soft` in the dark theme. */
  dark: { ground: "#1b1918", symbolColor: "#d4cdc5" },
  /** The same two in the light theme. */
  light: { ground: "#eeeae4", symbolColor: "#3b3632" },
  /** `--zy-scrim`, laid over the page under a dialog, in each theme. */
  scrim: {
    dark: { red: 0, green: 0, blue: 0, alpha: 0.62 },
    light: { red: 20, green: 22, blue: 26, alpha: 0.38 },
  },
  /**
   * The height of the bar less the rule along its bottom edge.
   *
   * A caption button is exactly as tall as the bar Windows is given, so this
   * is the bar's own height: taller does not leave the buttons alone, it grows
   * them, and shorter puts everything the app draws beside them on a different
   * line. The one pixel held back is the bar's bottom rule, which stays the
   * page's.
   */
  height: 43,
} as const;

/** Nothing: the controls are drawn straight onto the page. */
const UNDER_THE_CONTROLS = "#00000000";

/**
 * What Windows is told to draw the window controls with, for one theme. Under
 * a dialog the page beneath them is under its scrim, and their symbols are
 * dimmed to match, so they do not stand out as the one thing still lit.
 */
export function titleBarOverlay(dark: boolean, dimmed = false) {
  const colours = dark ? TITLE_BAR.dark : TITLE_BAR.light;
  const scrim = dark ? TITLE_BAR.scrim.dark : TITLE_BAR.scrim.light;
  return {
    color: UNDER_THE_CONTROLS,
    symbolColor: dimmed
      ? underScrim(colours.symbolColor, scrim)
      : colours.symbolColor,
    height: TITLE_BAR.height,
  };
}

/** The colour the window shows before the page has painted. */
export function windowGround(dark: boolean): string {
  return dark ? TITLE_BAR.dark.ground : TITLE_BAR.light.ground;
}

function underScrim(
  hex: string,
  scrim: (typeof TITLE_BAR.scrim)["dark" | "light"],
): string {
  const over = [scrim.red, scrim.green, scrim.blue];
  return `#${over
    .map((top, index) => {
      const under = Number.parseInt(
        hex.slice(1 + index * 2, 3 + index * 2),
        16,
      );
      return Math.round(under * (1 - scrim.alpha) + top * scrim.alpha)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}
