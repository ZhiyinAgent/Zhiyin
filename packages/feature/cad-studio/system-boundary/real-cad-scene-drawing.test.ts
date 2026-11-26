/**
 * Drawing a scene's lines, as Blender's Line Art gives them, with the real
 * drafting: lines found twice joined, rings read as circles, a section that
 * cuts nothing explained, and a busy scene's views sized, scaled and kept
 * readable. Skipped unless the CAD environment's Python is named, as the other
 * real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-scene-drawing.test.ts
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";
import {
  bladed,
  busyDrafting,
  type Call,
  type Result,
} from "./real-cad-studio.js";

const folders = new TemporaryFolders();

describe.skipIf(!python)(
  "drawing a scene's lines with the real drafting",
  () => {
    let root: string;
    let draw: (args: Record<string, unknown>) => Promise<Result>;
    let build: (args: Record<string, unknown>) => Promise<Result>;
    const text = (result: Result) => result.content[0]?.text ?? "";
    /** A ring modelled with `sides` sides, as Line Art gives its outline: one stroke back to its start. */
    const ring = (cx: number, cy: number, r: number, sides: number) =>
      Array.from({ length: sides + 1 }, (_, i) => [
        cx + r * Math.cos((2 * Math.PI * i) / sides),
        cy + r * Math.sin((2 * Math.PI * i) / sides),
      ]);
    // A 100 mm square seen from the top, as Line Art strokes it: round and on
    // past its first corner, its far edge found again behind it, a line behind
    // it across the middle, a ring of 12 sides and one of 6.
    const lines = {
      names: ["Board"],
      centre: [0, 0, 0],
      views: {
        top: {
          look: [0, 0, -1],
          up: [0, 1, 0],
          lines: [
            [
              "visible",
              [
                [-50, -50],
                [50, -50],
                [50, 50],
                [-50, 50],
                [-50, -50],
                [50, -50],
              ],
            ],
            [
              "hidden",
              [
                [-50, 50],
                [50, 50],
              ],
            ],
            [
              "hidden",
              [
                [0, -40],
                [0, 40],
              ],
            ],
            ["visible", ring(20, 0, 10, 12)],
            ["visible", ring(-25, 0, 10, 6)],
          ],
          cut: [],
          facing: null,
        },
        // Seen from the front: a round top's edge and its chamfer's, 5 mm
        // apart, and a flat into a fillet of 50 mm and on 5 mm straight.
        front: {
          look: [0, 1, 0],
          up: [0, 0, 1],
          lines: [
            ["visible", ring(0, 0, 600, 64)],
            ["visible", ring(0, 0, 595, 64)],
            [
              "visible",
              [
                [-1000, -50],
                ...Array.from({ length: 9 }, (_, i) => [
                  -900 + 50 * Math.cos(-Math.PI / 2 + (Math.PI / 2) * (i / 8)),
                  50 * Math.sin(-Math.PI / 2 + (Math.PI / 2) * (i / 8)),
                ]),
                [-850, 5],
              ],
            ],
          ],
          cut: [],
          facing: null,
        },
        // A section with nothing cut: as Blender gives one whose plane
        // misses every object, or cuts only those it leaves whole.
        A: {
          look: [0, 1, 0],
          up: [0, 0, 1],
          lines: [
            [
              "visible",
              [
                [-50, 0],
                [50, 0],
              ],
            ],
          ],
          cut: [],
          facing: null,
        },
      },
    };
    /** Says how many circles and lines a view's DXF holds, and how long the sheet's hidden lines are. */
    const counted = [
      "import ezdxf, math",
      "from build123d import Box",
      "view = ezdxf.readfile('scene/top.dxf').modelspace()",
      "print('circles', len(view.query('CIRCLE')), 'lines', len(view.query('LWPOLYLINE')))",
      "sheet = ezdxf.readfile('scene/sheet.dxf').modelspace()",
      "hidden = 0.0",
      "for line in sheet.query('LWPOLYLINE[layer==\"HIDDEN\"]'):",
      "    points = [(p[0], p[1]) for p in line.get_points()]",
      "    hidden += sum(math.dist(a, b) for a, b in zip(points, points[1:]))",
      "print('hidden', round(hidden, 1))",
      "show(Box(1, 1, 1), name='Check')",
    ].join("\n");

    beforeAll(async () => {
      root = await folders.make("zhiyin-real-cad-scene-");
      const data = await folders.make("zhiyin-real-cad-scene-data-");
      const tools = cadAutomation(await confinedPython(), {
        workspaceRoot: () => root,
        harness,
        directory: join(data, "cad-studio"),
        sceneLines: {
          installed: async () => true,
          open: async () => "board.blend",
          lines: async () => ({ ok: true, lines: JSON.stringify(lines) }),
        },
      });
      const call = (name: string) => async (args: Record<string, unknown>) => {
        const asked = await tools.inspect(name, args);
        if (!asked.ok) throw new Error(asked.reason);
        return (await tools.callTool(
          name,
          args,
          undefined,
          asked.identity,
        )) as Result;
      };
      draw = call("cad_draw");
      build = call("cad_build");
    }, 30_000);

    afterAll(() => folders.removeAll());

    it("joins what Line Art finds twice, leaves out what is behind what is seen, and reads a ring of 12 sides or more as a circle", async () => {
      const drawn = await draw({
        scene: true,
        views: [{ view: "top" }],
        scale: "1:1",
        dimensions: [
          {
            view: "top",
            kind: "length",
            from: [-50, -50, 0],
            to: [50, -50, 0],
          },
          { view: "top", kind: "diameter", at: [30, 0, 0] },
        ],
        outputs: [
          { path: "scene/top.dxf", view: "top" },
          { path: "scene/sheet.dxf" },
        ],
      });
      const checked = await build({ code: counted });

      expect(drawn.isError, text(drawn)).toBeUndefined();
      expect(text(drawn)).toContain("Dimensions on top: 100, Ø20.");
      // The square's four sides once each, the hexagon's six, the ring one circle.
      expect(text(checked)).toContain("circles 1 lines 10");
      // Only the line across the middle is behind: the far edge lies under what is seen.
      expect(text(checked)).toContain("hidden 80.0");
    }, 120_000);

    it("says why a section shows no cut: the plane misses the objects, or cuts only those it leaves whole", async () => {
      const section = (uncut?: string[]) =>
        draw({
          scene: true,
          views: [
            {
              section: "A",
              looking: "front",
              through: [0, 0, 0],
              ...(uncut ? { uncut } : {}),
            },
          ],
          outputs: [{ path: "scene/uncut.pdf" }],
        });

      const beside = await section();
      const whole = await section(["Board"]);

      expect(beside.isError).toBe(true);
      expect(text(beside)).toContain(
        "section A's plane through (0, 0, 0) cuts no object: it lies beside them; put it through one",
      );
      expect(whole.isError).toBe(true);
      expect(text(whole)).toContain(
        "section A's plane through (0, 0, 0) cuts no object it does not leave whole; put it through another, or cut the ones it leaves whole",
      );
    }, 120_000);

    it("finds no circle on a ring of fewer than 12 sides", async () => {
      const drawn = await draw({
        scene: true,
        views: [{ view: "top" }],
        dimensions: [{ view: "top", kind: "diameter", at: [-15, 0, 0] }],
        outputs: [{ path: "scene/refused.pdf" }],
      });

      expect(drawn.isError).toBe(true);
      expect(text(drawn)).toContain("dimension 1");
      expect(text(drawn)).toContain("no circle of the top view passes within");
    }, 120_000);

    it("keeps round edges a chamfer apart as two circles, and a fillet's radius beside a short flat", async () => {
      const drawn = await draw({
        scene: true,
        views: [{ view: "front" }],
        dimensions: [
          { view: "front", kind: "diameter", at: [600, 0, 0], expect: 1200 },
          { view: "front", kind: "diameter", at: [595, 0, 0], expect: 1190 },
          {
            view: "front",
            kind: "radius",
            at: [-900 + 50 * Math.SQRT1_2, 0, -50 * Math.SQRT1_2],
            expect: 50,
          },
        ],
        outputs: [{ path: "scene/front.pdf" }],
      });

      expect(drawn.isError, text(drawn)).toBeUndefined();
      expect(text(drawn)).toContain("Dimensions on front: Ø1200, Ø1190, R50.");
    }, 120_000);
  },
);

describe.skipIf(!python)("drawing a busy scene with the real drafting", () => {
  let root: string;
  let given: unknown;
  let draw: Call;
  const text = (result: Result) => result.content[0]?.text ?? "";

  beforeAll(async () => {
    const drafting = await busyDrafting(folders, () => given);
    root = drafting.root;
    draw = drafting.drawIn(60_000);
  }, 30_000);

  afterAll(() => folders.removeAll());

  /** A rectangle `across` by `up` mm round the view's middle, as one stroke. */
  const box = (across: number, up: number) => ({
    look: [0, 1, 0],
    up: [0, 0, 1],
    lines: [
      [
        "visible",
        [
          [-across / 2, -up / 2],
          [across / 2, -up / 2],
          [across / 2, up / 2],
          [-across / 2, up / 2],
          [-across / 2, -up / 2],
        ],
      ],
    ],
    cut: [],
    facing: null,
  });
  /** How many of a DXF's entities lie on its HIDDEN layer. */
  const hiddenIn = async (path: string) =>
    (await readFile(join(root, path), "utf8")).match(/\n\s*8\r?\nHIDDEN\r?\n/g)
      ?.length ?? 0;

  it("says how large each view is on the model, so its scale can be checked against the part", async () => {
    given = {
      names: ["Plate"],
      centre: [0, 0, 0],
      views: {
        front: box(100, 40),
        top: { ...box(100, 60), look: [0, 0, -1], up: [0, 1, 0] },
      },
    };

    const drawn = await draw({
      scene: true,
      views: [{ view: "front" }, { view: "top" }],
      outputs: [{ path: "busy/sizes.pdf" }],
    });

    expect(drawn.isError, text(drawn)).toBeUndefined();
    expect(text(drawn)).toContain(
      "Each view's size on the model, across by up: front view 100 × 40 mm, top view 100 × 60 mm.",
    );
  }, 120_000);

  it("names each view a failure inside the drafting came from", async () => {
    // Strokes with a point of one coordinate, which nothing checks before the drafting reads them.
    given = {
      names: ["Plate"],
      centre: [0, 0, 0],
      views: {
        front: box(100, 40),
        top: {
          ...box(100, 60),
          look: [0, 0, -1],
          up: [0, 1, 0],
          lines: [["visible", [[0, 0], [5, 0], [5, 5], [9]]]],
        },
        right: {
          ...box(60, 40),
          look: [-1, 0, 0],
          lines: [["visible", [[0, 0], [5, 0], [5, 5], [9]]]],
        },
      },
    };

    const drawn = await draw({
      scene: true,
      views: [{ view: "front" }, { view: "top" }, { view: "right" }],
      outputs: [{ path: "busy/failed.pdf" }],
    });

    expect(drawn.isError).toBe(true);
    expect(text(drawn)).toMatch(
      /the top view could not be drawn: [A-Za-z]+Error/,
    );
    expect(text(drawn)).toMatch(
      /the right view could not be drawn: [A-Za-z]+Error/,
    );
    expect(text(drawn)).not.toContain("front view could not");
  }, 120_000);

  it("steps the angled view down a scale, before the whole sheet, when only it keeps the views from fitting", async () => {
    // On A3 the front and top fit at 1:1 one above the other, and the
    // angled view, as large as the front, fits beside them only at 1:2.
    given = {
      names: ["Block"],
      centre: [0, 0, 0],
      views: {
        front: box(180, 100),
        top: { ...box(180, 80), look: [0, 0, -1], up: [0, 1, 0] },
        iso: { ...box(200, 150), look: [-1, 1, -1] },
      },
    };

    const drawn = await draw({
      scene: true,
      views: [{ view: "front" }, { view: "top" }, { view: "iso" }],
      outputs: [{ path: "busy/stepped.pdf" }],
    });

    expect(drawn.isError, text(drawn)).toBeUndefined();
    expect(text(drawn)).toContain(
      "Drew A3 landscape at 1:1, first-angle projection, in",
    );
    expect(text(drawn)).toContain(
      ": front view, top view and iso view at 1:2.",
    );
  }, 120_000);

  it("says when hidden edges crowd a view into a mass, and leaves them out of a view given hidden: false", async () => {
    given = {
      names: ["Rotor"],
      centre: [0, 0, 0],
      views: { front: bladed(60_000) },
    };

    const crowded = await draw({
      scene: true,
      views: [{ view: "front" }],
      outputs: [{ path: "busy/crowded.dxf" }],
    });
    const clear = await draw({
      scene: true,
      views: [{ view: "front", hidden: false }],
      outputs: [{ path: "busy/clear.dxf" }],
    });

    expect(crowded.isError, text(crowded)).toBeUndefined();
    expect(text(crowded)).toContain(
      "Hidden edges crowd the front view so closely that they read as a mass: give it hidden: false to leave them out.",
    );
    expect(await hiddenIn("busy/crowded.dxf")).toBeGreaterThan(1000);
    expect(clear.isError, text(clear)).toBeUndefined();
    expect(text(clear)).not.toContain("Hidden edges crowd");
    expect(await hiddenIn("busy/clear.dxf")).toBe(0);
  }, 180_000);
});
