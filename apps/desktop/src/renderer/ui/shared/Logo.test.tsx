/** The mark, which every module may draw. */

import markSource from "../../assets/logo-zhiyin.svg?raw";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo.js";

describe("Logo", () => {
  it("uses an accessible vector mark and can hide the wordmark", () => {
    const { rerender } = render(<Logo />);
    expect(
      screen.getByRole("img", { name: "Zhiyin" }).getAttribute("src"),
    ).toMatch(/^(data:image\/svg\+xml|.*logo-zhiyin\.svg$)/);
    expect(screen.getByText("ZHIYIN")).toBeInTheDocument();

    rerender(<Logo compact />);
    expect(screen.queryByText("ZHIYIN")).not.toBeInTheDocument();
  });

  it("draws the mark with enough ink to survive being small", () => {
    // A design tool can export the mark as the *outline* of artwork meant to
    // be filled: `fill="none"` with a hairline stroke. At the sizes the app
    // draws it, that stroke lands below one device pixel and the mark renders
    // as a grey smudge. Nothing on screen can be asserted for that in a DOM
    // test, but the export that causes it can be.
    //
    // The property is ink, not fill: a mark deliberately drawn as a line is
    // fine, provided its line is thick enough relative to its own artwork to
    // still be there at 22px. A stroke under 1% of the viewBox is not.
    const [, viewBoxWidth] =
      /viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/.exec(markSource) ?? [];
    expect(Number(viewBoxWidth)).toBeGreaterThan(0);

    const strokes = [...markSource.matchAll(/stroke-width="([\d.]+)"/g)].map(
      ([, width]) => Number(width),
    );
    const filled = !/fill="none"/.test(markSource);
    expect(
      filled || strokes.every((width) => width > Number(viewBoxWidth) * 0.01),
    ).toBe(true);
  });
});
