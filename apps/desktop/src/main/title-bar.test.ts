/**
 * The main process tells Windows what colour and height to draw the window
 * controls at; the renderer paints the strip they sit on. Nothing connects the
 * two but agreement, so the agreement is what is checked here: the numbers in
 * the main process are read back out of the stylesheet that owns them.
 *
 * Without this check, re-theming the app would leave the three controls on the
 * old background in a bar of another colour, and nothing would report it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TITLE_BAR, titleBarOverlay } from "./title-bar.js";

const foundations = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../renderer/ui/foundations.css",
  ),
  "utf8",
);

const lightRule = "@media (prefers-color-scheme: light)";

/** A token as the dark theme defines it, or as the light one overrides it. */
function token(name: string, scheme: "dark" | "light" = "dark"): string {
  const at = foundations.indexOf(lightRule);
  const block =
    scheme === "dark" ? foundations.slice(0, at) : foundations.slice(at);
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!match?.[1])
    throw new Error(`The ${scheme} theme has no --${name} to paint with.`);
  return match[1].trim();
}

describe("the title bar the window controls sit on", () => {
  it("is painted the colour the app paints the strip, in either theme", () => {
    expect(titleBarOverlay(true).color).toBe(token("zy-canvas"));
    expect(titleBarOverlay(false).color).toBe(token("zy-canvas", "light"));
  });

  it("draws its symbols in the app's own soft text colour, in either theme", () => {
    expect(titleBarOverlay(true).symbolColor).toBe(token("zy-text-soft"));
    expect(titleBarOverlay(false).symbolColor).toBe(
      token("zy-text-soft", "light"),
    );
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
  /** A colour seen through the scrim a dialog lays over the page. */
  function underScrim(hex: string, scheme: "dark" | "light"): string {
    const [red, green, blue, alpha] = /rgba\(([^)]+)\)/
      .exec(token("zy-scrim", scheme))![1]!
      .split(",")
      .map(Number) as [number, number, number, number];
    const over = [red, green, blue];
    return `#${[1, 3, 5]
      .map((at, index) => {
        const under = Number.parseInt(hex.slice(at, at + 2), 16);
        return Math.round(under * (1 - alpha) + over[index]! * alpha)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")}`;
  }

  it.each(["dark", "light"] as const)(
    "is dimmed under a dialog as the page is, in the %s theme",
    (scheme) => {
      const dimmed = titleBarOverlay(scheme === "dark", true);

      expect(dimmed.color).toBe(underScrim(token("zy-canvas", scheme), scheme));
      expect(dimmed.symbolColor).toBe(
        underScrim(token("zy-text-soft", scheme), scheme),
      );
    },
  );

  it("stops one pixel short of the bar, so its rule survives and its buttons stay on the line", () => {
    const bar = Number.parseInt(token("zy-title-bar-height"), 10);

    expect(TITLE_BAR.height).toBe(bar - 1);
    expect(titleBarOverlay(false).height).toBe(bar - 1);
  });
});
