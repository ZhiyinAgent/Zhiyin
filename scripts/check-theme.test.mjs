import { describe, expect, it } from "vitest";
import { problemsInRenderer, themeProblems } from "./check-theme.mjs";

const dark =
  ":root {\n  color-scheme: dark;\n  --zy-text: #f2f2f3;\n  --zy-wash: rgba(255, 255, 255, 0.05);\n}";
const light =
  "@media (prefers-color-scheme: light) {\n  :root {\n    color-scheme: light;\n    --zy-text: #1a1b1d;\n    --zy-wash: rgba(0, 0, 0, 0.05);\n  }\n}";
const measurements = ":root {\n  --zy-gap: 8px;\n}";

function foundations(...blocks) {
  return { path: "ui/foundations.css", text: blocks.join("\n\n") };
}

describe("the theme check", () => {
  it("accepts a dark and a light theme that define the same colours", () => {
    expect(themeProblems([foundations(dark, measurements, light)])).toEqual([]);
  });

  it("refuses a colour the light theme does not repaint", () => {
    const withoutWash = light.replace(/\n {4}--zy-wash[^\n]*/, "");

    expect(themeProblems([foundations(dark, withoutWash)])).toEqual([
      expect.stringContaining(
        "--zy-wash is in the dark theme but not the light",
      ),
    ]);
  });

  it("refuses a light colour the dark theme never defines", () => {
    const extra = light.replace(
      "color-scheme: light;",
      "color-scheme: light;\n    --zy-glow: #ffffff;",
    );

    expect(themeProblems([foundations(dark, extra)])).toEqual([
      expect.stringContaining(
        "--zy-glow is in the light theme but not the dark",
      ),
    ]);
  });

  it("refuses a literal colour outside the two themes", () => {
    const sheet = {
      path: "ui/app/app.module.css",
      text: ".a { color: #fff; }",
    };

    expect(themeProblems([foundations(dark, light), sheet])).toEqual([
      expect.stringContaining("ui/app/app.module.css:1: literal colour"),
    ]);
    expect(
      themeProblems([foundations(dark, ":root {\n  --zy-x: #000;\n}", light)]),
    ).toEqual([expect.stringContaining("literal colour")]);
  });

  it("refuses a token used but never defined", () => {
    const sheet = {
      path: "ui/app/app.module.css",
      text: ".a { color: var(--zy-missing); gap: var(--zy-gap); }",
    };

    expect(
      themeProblems([foundations(dark, measurements, light), sheet]),
    ).toEqual([
      expect.stringContaining("--zy-missing is used but never defined"),
    ]);
  });

  it("refuses text smaller than 12 px", () => {
    const sheet = {
      path: "ui/app/app.module.css",
      text: ".a { font-size: 12px; }\n.b { font-size: 11.5px; }",
    };

    expect(themeProblems([foundations(dark, light), sheet])).toEqual([
      expect.stringContaining(
        "ui/app/app.module.css:2: text smaller than 12 px",
      ),
    ]);
  });

  it("refuses text smaller than 12 px set through the font shorthand", () => {
    const sheet = {
      path: "ui/app/app.module.css",
      text: [
        ".a { font: 600 12.5px/1.4 serif; }",
        ".b { font: 600 10px/1.4 serif; }",
        ".c { font: 11px serif; }",
      ].join("\n"),
    };

    expect(themeProblems([foundations(dark, light), sheet])).toEqual([
      expect.stringContaining(
        "ui/app/app.module.css:2: text smaller than 12 px",
      ),
      expect.stringContaining(
        "ui/app/app.module.css:3: text smaller than 12 px",
      ),
    ]);
  });

  it("refuses a text colour that reads below 4.5:1 on a ground of its theme", () => {
    const grounds = dark.replace(
      "color-scheme: dark;",
      "color-scheme: dark;\n  --zy-canvas: #1b1c1e;\n  --zy-faint: #7b7d83;",
    );
    const lightGrounds = light.replace(
      "color-scheme: light;",
      "color-scheme: light;\n    --zy-canvas: #f4f4f2;\n    --zy-faint: #5f6268;",
    );

    expect(themeProblems([foundations(grounds, lightGrounds)])).toEqual([
      expect.stringContaining(
        "--zy-faint reads at 4.14:1 on --zy-canvas in the dark theme",
      ),
    ]);
  });

  it("refuses any custom property used but set nowhere, in a stylesheet or a component", () => {
    const sheet = {
      path: "ui/recovery/recovery.module.css",
      text: ".a { gap: var(--space-3); width: var(--share); }",
    };

    expect(
      themeProblems([foundations(dark, light), sheet], new Set(["--share"])),
    ).toEqual([expect.stringContaining("--space-3 is used but never defined")]);
  });

  it("finds nothing wrong with the app's own stylesheets", async () => {
    expect(await problemsInRenderer()).toEqual([]);
  });
});
