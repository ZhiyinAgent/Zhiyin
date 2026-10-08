/**
 * The window's own title bar, drawn by the app rather than by Windows.
 *
 * Windows keeps drawing the three controls — minimize, maximize, close — so
 * Snap Layouts, the maximize hover flyout, the system menu and the hit-target
 * sizes all stay the ones a person already knows. What the app takes over is
 * the bar they sit on, which is the app's own top bar and not a strip above
 * it. So the colours here have to be the ones the renderer paints that bar
 * with: the app's ground, and its soft text colour, in whichever theme is
 * showing. They are written out because the main process cannot read a
 * stylesheet, and a test holds them to the tokens so a re-theme cannot leave
 * the controls floating on last season's colour.
 */
export const TITLE_BAR = {
  /** `--zy-canvas` and `--zy-text-soft` in the dark theme. */
  dark: { color: "#1b1c1e", symbolColor: "#cfd1d4" },
  /** The same two in the light theme. */
  light: { color: "#f4f4f2", symbolColor: "#3a3c40" },
  /**
   * The height of the bar less the rule along its bottom edge.
   *
   * A caption button is exactly as tall as the bar Windows is given, so this
   * is the bar's own height: taller does not leave the buttons alone, it grows
   * them, and shorter puts everything the app draws beside them on a different
   * line. The one pixel held back is the bar's bottom rule. Windows paints
   * this whole rectangle over the page, so a rule drawn inside it would stop
   * dead where the controls begin.
   */
  height: 43,
} as const;

/** What Windows is told to draw the window controls on, for one theme. */
export function titleBarOverlay(dark: boolean) {
  return {
    ...(dark ? TITLE_BAR.dark : TITLE_BAR.light),
    height: TITLE_BAR.height,
  };
}
