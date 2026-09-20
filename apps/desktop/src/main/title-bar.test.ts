/**
 * The main process tells Windows what colour and height to draw the window
 * controls at; the renderer paints the strip they sit on. Nothing connects the
 * two but agreement, so the agreement is what is checked here: the numbers in
 * the main process are read back out of the stylesheet that owns them.
 *
 * The failure this catches is silent and ugly. Re-theme the app, and the three
 * controls keep last season's background in a bar that is now another colour.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TITLE_BAR } from "./title-bar.js";

const foundations = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../renderer/ui/foundations.css",
  ),
  "utf8",
);

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(foundations);
  if (!match?.[1]) throw new Error(`The app has no --${name} to theme with.`);
  return match[1].trim();
}

describe("the title bar the window controls sit on", () => {
  it("is painted the colour the app paints the strip", () => {
    expect(TITLE_BAR.color).toBe(token("zy-canvas"));
  });

  it("draws its symbols in the app's own soft text colour", () => {
    expect(TITLE_BAR.symbolColor).toBe(token("zy-text-soft"));
  });

  /*
   * Two failures meet at this one number, and they pull in opposite
   * directions. A caption button is as tall as the bar Windows is given, so
   * anything shorter than the bar puts the app's own buttons off the line of
   * the window's. But Windows paints that same rectangle over the page, so
   * anything as tall as the bar swallows the rule along the bar's bottom edge
   * and the rule stops dead where the controls begin. One pixel short of the
   * bar is the only value that is neither.
   */
  it("stops one pixel short of the bar, so its rule survives and its buttons stay on the line", () => {
    const bar = Number.parseInt(token("zy-title-bar-height"), 10);

    expect(TITLE_BAR.height).toBe(bar - 1);
  });
});
