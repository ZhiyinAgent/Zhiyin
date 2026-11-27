/**
 * A drawing's angles, chamfers, hole callouts and ordinates, and its parts
 * list with balloons, against a real build123d and bd_warehouse: each read
 * from the part as drawn, a tapped hole's thread from the bd_warehouse class
 * that made it. Skipped unless the CAD environment's Python is named, as the
 * other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-drawing-kinds.test.ts
 */

import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import {
  confinedPython,
  harness,
  keptFonts,
  python,
} from "./confined-cad-python.js";

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

const folders = new TemporaryFolders();

/**
 * A block 100 × 60 × 40 about the origin, its top right corner sloped off at
 * 30°, its top left edge chamfered 2 mm; from its top, two M8 holes tapped
 * 12 deep by bd_warehouse, a counterbored clearance hole for an M8 socket
 * screw, a countersunk hole and a plain blind hole.
 */
const block = [
  "from build123d import *",
  "from bd_warehouse.fastener import ClearanceHole, SocketHeadCapScrew, TapHole",
  'screw = SocketHeadCapScrew("M8-1.25", 20, "iso4762", simple=True)',
  "with BuildPart() as block:",
  "    with BuildSketch(Plane.XZ):",
  "        Polygon((-50, -20), (50, -20), (50, 0), (50 - 20 / 0.5773502691896258, 20), (-50, 20), align=None)",
  "    extrude(amount=30, both=True)",
  "    chamfer(block.edges().filter_by(Axis.Y).group_by(Axis.X)[0].sort_by(Axis.Z)[-1], length=2)",
  "    with Locations((-30, -15, 20), (-30, 15, 20)):",
  "        TapHole(screw, depth=12, counter_sunk=False)",
  "    with Locations((0, 15, 20)):",
  '        ClearanceHole(screw, fit="Normal")',
  "    with Locations((0, -15, 20)):",
  "        CounterSinkHole(radius=3, counter_sink_radius=6, counter_sink_angle=90)",
  "    with Locations((-15, 0, 20)):",
  "        Hole(radius=2.5, depth=10)",
  'show(block, name="Block")',
].join("\n");

describe.skipIf(!python)(
  "a drawing's dimension kinds and parts list, with a real build123d",
  () => {
    let draw: (args: Record<string, unknown>) => Promise<Result>;
    const text = (result: Result) => result.content[0]?.text ?? "";

    beforeAll(async () => {
      const root = await folders.make("zhiyin-real-cad-kinds-workspace-");
      const data = await folders.make("zhiyin-real-cad-kinds-data-");
      const tools = cadAutomation(await confinedPython(), {
        workspaceRoot: () => root,
        harness,
        directory: join(data, "cad-studio"),
        fonts: await keptFonts(),
      });
      draw = async (args) => {
        const asked = await tools.inspect("cad_draw", args);
        if (!asked.ok) throw new Error(asked.reason);
        return (await tools.callTool(
          "cad_draw",
          args,
          undefined,
          asked.identity,
        )) as Result;
      };
    }, 30_000);

    afterAll(() => folders.removeAll());

    it("writes an angle, a chamfer, hole callouts read from the solid and ordinates from a datum, each as measured", async () => {
      const result = await draw({
        code: block,
        views: [{ view: "front" }, { view: "top" }],
        dimensions: [
          { view: "front", kind: "chamfer", at: [-49, -30, 19], expect: 2 },
          {
            view: "front",
            kind: "angle",
            from: [-20, -30, 20],
            to: [32.68, -30, 10],
            expect: 150,
          },
          {
            view: "top",
            kind: "ordinate",
            direction: "horizontal",
            from: [-50, -30, 20],
            to: [-30, -15, 20],
          },
          {
            view: "top",
            kind: "ordinate",
            direction: "horizontal",
            from: [-50, -30, 20],
            to: [-15, 0, 20],
          },
          {
            view: "top",
            kind: "ordinate",
            direction: "horizontal",
            from: [-50, -30, 20],
            to: [0, -15, 20],
            expect: 50,
          },
          {
            view: "top",
            kind: "hole_callout",
            at: [-30, -15, 20],
            all: true,
            expect: 6.8,
          },
          { view: "top", kind: "hole_callout", at: [0, 15, 20] },
          { view: "top", kind: "hole_callout", at: [0, -15, 20] },
          { view: "top", kind: "hole_callout", expect: 5 },
        ],
        outputs: [{ path: "drawings/block.pdf" }],
      });
      const answer = text(result);

      expect(result.isError, answer).toBeUndefined();
      expect(answer).toContain("Dimensions on front: C2, 150°.");
      expect(answer).toContain(
        "Dimensions on top: 20, 35, 50, 2× M8×1.25-6H ↧12, Ø9 THRU ⌴Ø14.27 ↧8, Ø6 THRU ⌵Ø12×90°, Ø5 ↧10.",
      );
      expect(answer).toContain(
        "C2 on front: 2 × 2 mm, at 45° to its longer leg's edge.",
      );
      expect(answer).toContain(
        "2× M8×1.25-6H ↧12 on top: the hole at (-30, -15, 20): drilled Ø6.8, 12 deep from its face, to a drill point of 98°, threaded M8×1.25 as bd_warehouse's TapHole made it, its class 6H the standard's medium fit, as the model holds none.",
      );
      expect(answer).toContain(
        "Ø9 THRU ⌴Ø14.27 ↧8 on top: the hole at (0, 15, 20): drilled Ø9 right through, counterbored Ø14.27, 8 deep, made by bd_warehouse for SocketHeadCapScrew M8-1.25, unthreaded.",
      );
      expect(answer).toContain(
        "Ø6 THRU ⌵Ø12×90° on top: the hole at (0, -15, 20): drilled Ø6 right through, countersunk Ø12 at 90°, no thread is known of it",
      );
      expect(answer).toContain(
        "Ø5 ↧10 on top: the hole at (-15, 0, 20): drilled Ø5, 10 deep from its face, no thread is known of it: a hole tapped with bd_warehouse's TapHole or ThreadedHole in a BuildPart, and not moved after, is written with its thread.",
      );
    }, 240_000);

    it("refuses an angle between edges side by side, a callout expected at another size, and a chamfer where the part has none", async () => {
      const result = await draw({
        code: block,
        views: [{ view: "front" }, { view: "top" }],
        dimensions: [
          {
            view: "front",
            kind: "angle",
            from: [-20, -30, 20],
            to: [0, -30, -20],
          },
          { view: "top", kind: "hole_callout", at: [-30, 15, 20], expect: 8 },
          { view: "front", kind: "chamfer", at: [0, -30, -20] },
        ],
        outputs: [{ path: "drawings/refused.pdf" }],
      });
      const answer = text(result);

      expect(result.isError).toBe(true);
      expect(answer).toContain(
        "- the two edges for dimension 1 run side by side in the front view, so they meet at no angle; measure how far apart they are as a length",
      );
      expect(answer).toContain(
        "- dimension 2 is a hole drilled Ø6.8 (M8×1.25-6H ↧12) on the part, where Ø8 was expected; a callout's expect is its drilled diameter",
      );
      expect(answer).toContain(
        "- the edge for dimension 3 in the front view runs between two edges side by side, so it cuts no corner, as a chamfer does; a chamfer is given where it is seen side on, a slanted edge across a corner",
      );
    }, 240_000);

    it("draws a parts list above the title block and balloons each item on the angled view, naming one that shows in no view", async () => {
      const result = await draw({
        code: [
          "from build123d import *",
          "from bd_warehouse.fastener import SocketHeadCapScrew",
          "plate = Box(80, 50, 8)",
          "for x in (-30, 30):",
          "    for y in (-15, 15):",
          "        plate -= Pos(x, y, 0) * Cylinder(3.3, 8)",
          'show(plate, name="Plate")',
          'screw = SocketHeadCapScrew("M6-1", 20, "iso4762", simple=True)',
          'show([Pos(x, y, 4) * screw for x in (-30, 30) for y in (-15, 15)], name="Screw")',
          'show(Pos(0, 60, 0) * (Box(30, 30, 30) - Box(20, 20, 20)), name="Housing")',
          'show(Pos(0, 60, 0) * Cylinder(4, 10), name="Pin")',
        ].join("\n"),
        views: [{ view: "front" }, { view: "top" }, { view: "iso" }],
        parts_list: true,
        materials: {
          Plate: "aluminium",
          "/Screw.*/": "steel",
          Housing: "PLA",
          Pin: "steel",
        },
        outputs: [{ path: "drawings/assembly.pdf" }],
      });
      const answer = text(result);

      expect(result.isError, answer).toBeUndefined();
      expect(answer).toContain(
        [
          "A parts list of 4 rows from 7 parts above the title block, each item ballooned on the iso view:",
          "- 1: 1 × Plate: made, 80 × 50 × 8 mm, aluminium, 83.44 g.",
          "- 2: 4 × Screw (Screw 1, Screw 2, Screw 3 and Screw 4, the same part): bought, socket head cap screw ISO 4762 M6-1 × 20, bd_warehouse's SocketHeadCapScrew, steel, 6.32 g each.",
          "- 3: 1 × Housing: made, 30 × 30 × 30 mm, PLA, 23.56 g.",
          "- 4: 1 × Pin: made, 10 × 8 × 8 mm, steel, 3.95 g.",
          "No balloon for item 4, Pin: no point of it shows in any view of the drawing, others standing in front, and no section cuts it; a section through it shows it.",
        ].join("\n"),
      );
    }, 240_000);
  },
);
