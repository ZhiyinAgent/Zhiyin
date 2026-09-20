/**
 * The window's own title bar, drawn by the app rather than by Windows.
 *
 * Windows keeps drawing the three controls — minimize, maximize, close — so
 * Snap Layouts, the maximize hover flyout, the system menu and the hit-target
 * sizes all stay the ones a person already knows. What the app takes over is
 * the bar they sit on, which is the app's own top bar and not a strip above
 * it. So the colours here have to be the ones the renderer paints that bar
 * with: the app's ground, and its soft text colour. They are written out
 * because the main process cannot read a stylesheet, and a test holds them to
 * the tokens so a re-theme cannot leave the controls floating on last season's
 * colour.
 */
export const TITLE_BAR = {
  /** Matches `--zy-canvas`. */
  color: "#1b1c1e",
  /** Matches `--zy-text-soft`. */
  symbolColor: "#cfd1d4",
  /**
   * The height of the bar less the rule along its bottom edge.
   *
   * A caption button is exactly as tall as the bar Windows is given, so this
   * is the bar's own height: taller does not leave the buttons alone, it grows
   * them, and shorter puts everything the app draws beside them on a different
   * line. The one pixel held back is the bar's bottom rule. Windows paints
   * this whole rectangle over the page, so a rule drawn inside it is a rule
   * that stops dead where the controls begin - which is what it did.
   */
  height: 43,
} as const;
