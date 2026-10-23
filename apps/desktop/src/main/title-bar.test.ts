/**
 * The main process tells Windows what colour and height to draw the window
 * controls at; the renderer paints the strip they sit on. Nothing connects the
 * two but agreement, so the agreement is what is checked here: the numbers in
 * the main process are read back out of the stylesheet that owns them.
 *
 * Without this check, re-theming the app would leave the three controls' symbols
 * and the window's first ground in last season's colours, and nothing would
 * report it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TITLE_BAR, titleBarOverlay, windowGround } from "./title-bar.js";

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
  it("lets the page's own ground show under the controls, dimmed or not", () => {
    for (const dark of [true, false])
      for (const dimmed of [true, false])
        expect(titleBarOverlay(dark, dimmed).color).toBe("#00000000");
  });

  it("shows the app's ground before the page paints, in either theme", () => {
    expect(windowGround(true)).toBe(token("zy-canvas"));
    expect(windowGround(false)).toBe(token("zy-canvas", "light"));
  });

  it("draws its symbols in the app's own soft text colour, in either theme", () => {
    expect(titleBarOverlay(true).symbolColor).toBe(token("zy-text-soft"));
    expect(titleBarOverlay(false).symbolColor).toBe(
      token("zy-text-soft", "light"),
    );
  });

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
    "dims its symbols under a dialog as the page is, in the %s theme",
    (scheme) => {
      const dimmed = titleBarOverlay(scheme === "dark", true);

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
