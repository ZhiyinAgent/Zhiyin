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

  it("refuses a literal colour written into a data URI", () => {
    const sheet = {
      path: "ui/model/model.module.css",
      text: ".select { background-image: url(\"data:image/svg+xml;utf8,<svg><path stroke='%239b9da2'/></svg>\"); }",
    };

    expect(themeProblems([foundations(dark, light), sheet])).toEqual([
      expect.stringContaining("ui/model/model.module.css:1: literal colour"),
    ]);
  });

  it("refuses a tooltip a stylesheet draws itself, beside the shared one, however its text is reached", () => {
    const sheet = {
      path: "ui/actions/actions.module.css",
      text: [
        ".badge:hover::after { content: attr(data-tooltip); }",
        ".tip { --tip: ATTR(title); }",
        ".tip::after { content: var(--tip); }",
        ".row { justify-content: center; }",
      ].join("\n"),
    };

    expect(themeProblems([foundations(dark, light), sheet])).toEqual([
      expect.stringContaining(
        "ui/actions/actions.module.css:1: a value read from an attribute",
      ),
      expect.stringContaining(
        "ui/actions/actions.module.css:2: a value read from an attribute",
      ),
    ]);
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

  it("refuses a size relative to its parent unless it holds the 12 px floor", () => {
    const sheet = {
      path: "ui/app/app.module.css",
      text: [
        ".a { font-size: max(12px, 0.82em); }",
        ".b { font: max(12px, 0.88em)/1.5 serif; }",
        ".c { font-size: 0.82em; }",
        ".d { font: 0.88em/1.5 serif; }",
        ".e { font-size: 90%; }",
        ".f { font-size: smaller; }",
        ".g { font-size: max(11px, 0.82em); }",
      ].join("\n"),
    };

    expect(themeProblems([foundations(dark, light), sheet])).toEqual(
      [3, 4, 5, 6]
        .map((line) =>
          expect.stringContaining(
            `ui/app/app.module.css:${line}: text sized against its parent`,
          ),
        )
        .concat([
          expect.stringContaining(
            "ui/app/app.module.css:7: text smaller than 12 px",
          ),
        ]),
    );
  });

  it("reads a size in rem against the 16 px root", () => {
    const sheet = {
      path: "ui/app/app.module.css",
      text: ".a { font-size: 0.85rem; }\n.b { font: 400 0.7rem / normal serif; }",
    };

    expect(themeProblems([foundations(dark, light), sheet])).toEqual([
      expect.stringContaining(
        "ui/app/app.module.css:2: text smaller than 12 px",
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

  it("refuses a chart mark colour that stands out below 3:1 on a ground of its theme", () => {
    const grounds = dark.replace(
      "color-scheme: dark;",
      "color-scheme: dark;\n  --zy-panel-soft: #17181a;\n  --zy-chart-4: #3b3e43;\n  --zy-chart-5: #63666c;",
    );
    const lightGrounds = light.replace(
      "color-scheme: light;",
      "color-scheme: light;\n    --zy-panel-soft: #f0f0ee;\n    --zy-chart-4: #4766b0;\n    --zy-chart-5: #8a8a86;",
    );

    expect(themeProblems([foundations(grounds, lightGrounds)])).toEqual([
      expect.stringContaining(
        "--zy-chart-4 stands out at 1.65:1 on --zy-panel-soft in the dark theme, under 3:1",
      ),
    ]);
  });

  it("refuses a numbered series, such as a chart's fourth model, drawn in a colour held to no contrast floor", () => {
    const themes = [
      dark.replace(
        "color-scheme: dark;",
        "color-scheme: dark;\n  --zy-line-strong: #3a3c40;\n  --zy-chart-4: #9aa3b5;",
      ),
      light.replace(
        "color-scheme: light;",
        "color-scheme: light;\n    --zy-line-strong: #c9c9c5;\n    --zy-chart-4: #4766b0;",
      ),
    ];
    const sheet = (colour) => ({
      path: "ui/usage/usage.module.css",
      text: `.model-dial__segment--3 {\n  stroke: var(${colour});\n}\n.model-key--3 {\n  background: var(--zy-chart-4);\n}\n.model-dial__track {\n  stroke: var(--zy-line-strong);\n}`,
    });

    expect(
      themeProblems([foundations(...themes), sheet("--zy-chart-4")]),
    ).toEqual([]);
    expect(
      themeProblems([foundations(...themes), sheet("--zy-line-strong")]),
    ).toEqual([
      expect.stringContaining(
        "ui/usage/usage.module.css:2: --zy-line-strong draws a numbered series",
      ),
    ]);
  });

  it.each([
    [
      "a selector list laid out a selector a line",
      ".model-key--3,\n.model-swatch {\n  background: var(--zy-line-strong);\n}",
      3,
    ],
    [
      "a shorthand",
      ".model-key--3 {\n  border-left: 6px solid var(--zy-line-strong);\n}",
      2,
    ],
    [
      "an outline",
      ".model-key--3 {\n  outline-color: var(--zy-line-strong);\n}",
      2,
    ],
  ])(
    "refuses a numbered series drawn in such a colour through %s",
    (_how, text, line) => {
      const themes = [
        dark.replace(
          "color-scheme: dark;",
          "color-scheme: dark;\n  --zy-line-strong: #3a3c40;\n  --zy-chart-4: #9aa3b5;",
        ),
        light.replace(
          "color-scheme: light;",
          "color-scheme: light;\n    --zy-line-strong: #c9c9c5;\n    --zy-chart-4: #4766b0;",
        ),
      ];

      expect(
        themeProblems([
          foundations(...themes),
          { path: "ui/usage/usage.module.css", text },
        ]),
      ).toEqual([
        expect.stringContaining(
          `ui/usage/usage.module.css:${line}: --zy-line-strong draws a numbered series`,
        ),
      ]);
    },
  );

  it("lets a numbered series take a measurement beside its colour", () => {
    const themes = [
      dark.replace(
        "color-scheme: dark;",
        "color-scheme: dark;\n  --zy-chart-4: #9aa3b5;",
      ),
      light.replace(
        "color-scheme: light;",
        "color-scheme: light;\n    --zy-chart-4: #4766b0;",
      ),
    ];
    const sheet = {
      path: "ui/usage/usage.module.css",
      text: ".model-key--3 {\n  border-left: var(--zy-gap) solid var(--zy-chart-4);\n}",
    };

    expect(
      themeProblems([foundations(...themes, measurements), sheet]),
    ).toEqual([]);
  });

  it("refuses a text colour or ground whose contrast it cannot read", () => {
    const grounds = dark.replace(
      "color-scheme: dark;",
      "color-scheme: dark;\n  --zy-canvas: #1b1c1e;\n  --zy-faint: rgb(123, 125, 131);",
    );
    const lightGrounds = light.replace(
      "color-scheme: light;",
      "color-scheme: light;\n    --zy-canvas: #f4f4f2;\n    --zy-faint: #5f6268;",
    );

    expect(themeProblems([foundations(grounds, lightGrounds)])).toEqual([
      expect.stringContaining(
        "--zy-faint in the dark theme is not a six-digit hex colour",
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
