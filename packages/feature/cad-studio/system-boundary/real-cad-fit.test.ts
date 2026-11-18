/**
 * Whether a part goes into its place, checked against a real build123d: an
 * insert requirement moves the part in along its way from clear of the
 * parts it goes into, and says where it would meet one and how far into it,
 * or how near it passes. Skipped unless ZHIYIN_CAD_PYTHON names the CAD
 * environment's Python, as the other real-CAD tests are.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

type Result = { isError?: boolean; content: { type: string; text?: string }[] };

const folders = new TemporaryFolders();

/** A 5 mm plate with a Ø4.6 bore through its middle, upright along z. */
const plate = [
  "from build123d import *",
  "plate = Box(40, 20, 5) - Cylinder(2.3, 10)",
  'show(plate, name="Plate")',
];

describe.skipIf(!python)(
  "checking how a part goes in, with a real build123d",
  () => {
    let root: string;
    let build: (args: Record<string, unknown>) => Promise<Result>;

    beforeAll(async () => {
      root = await folders.make("zhiyin-real-cad-fit-workspace-");
      const data = await folders.make("zhiyin-real-cad-fit-data-");
      const tools = cadAutomation(await confinedPython(), {
        workspaceRoot: () => root,
        harness,
        directory: join(data, "cad-studio"),
      });
      build = async (args) => {
        const asked = await tools.inspect("cad_build", args);
        if (!asked.ok) throw new Error(asked.reason);
        return (await tools.callTool(
          "cad_build",
          args,
          undefined,
          asked.identity,
        )) as Result;
      };
    }, 30_000);

    afterAll(() => folders.removeAll());

    const text = (result: Result) => result.content[0]?.text ?? "";

    it("says an axle with a head on each end cannot go in through a bore narrower than its heads: where it meets the plate, and how far into it it would go", async () => {
      await writeFile(
        join(root, "axle.json"),
        JSON.stringify({
          requirements: [
            {
              id: "R1",
              says: "The axle goes in from above",
              check: "insert",
              part: "Axle",
              along: [0, 0, -1],
            },
          ],
        }),
      );
      const result = await build({
        code: [
          ...plate,
          // A Ø4 shaft through the bore, a Ø6 head 1.6 mm long on each end.
          "axle = Cylinder(2, 20) + Pos(0, 0, -10.8) * Cylinder(3, 1.6) + Pos(0, 0, 10.8) * Cylinder(3, 1.6)",
          'show(axle, name="Axle")',
        ].join("\n"),
        requirements: "axle.json",
      });

      expect(result.isError, text(result)).toBeUndefined();
      // Coming down, its lower head reaches the plate's top 14.1 mm above its
      // place, and passing through the bore it would cut a ring 0.7 mm thick.
      expect(text(result)).toMatch(
        /- R1 \(The axle goes in from above\) fails: Axle cannot go in along -z: 14\.1 mm short of its place it meets Plate at \(-?[\d.]+, -?[\d.]+, 2\.5\), and would go 0\.7 mm into it; 0\.7 mm past the limit\./,
      );
    }, 180_000);

    it("says a headed pin goes into its bore without meeting the plate, how near it passes, and that its head sits on the plate", async () => {
      await writeFile(
        join(root, "pin.json"),
        JSON.stringify({
          requirements: [
            {
              id: "R1",
              check: "insert",
              part: "Pin",
              into: ["Plate"],
              along: [0, 0, -1],
              min: 0.2,
            },
          ],
        }),
      );
      const result = await build({
        code: [
          ...plate,
          // A Ø4 shank through the Ø4.6 bore, its Ø6 head on the plate's top.
          "pin = Pos(0, 0, -1) * Cylinder(2, 7) + Pos(0, 0, 3.25) * Cylinder(3, 1.5)",
          'show(pin, name="Pin")',
        ].join("\n"),
        requirements: "pin.json",
      });

      expect(result.isError, text(result)).toBeUndefined();
      const said =
        /- R1 holds: Pin goes in along -z from 8 mm out without meeting Plate; it passes Plate ([\d.]+) mm apart at the least, and sits against it at its place; ([\d.]+) mm to spare\./.exec(
          text(result),
        );
      expect(said, text(result)).not.toBeNull();
      // The bore is 0.3 mm wider than the shank all round; the meshes hold to a fiftieth of a millimetre.
      expect(Number(said![1])).toBeGreaterThan(0.27);
      expect(Number(said![1])).toBeLessThanOrEqual(0.3);
      // Each is said to three figures, so they agree to the gap's last one.
      expect(Number(said![2])).toBeCloseTo(Number(said![1]) - 0.2, 3);
    }, 180_000);

    it("says a lid onto a box goes in when its skirt clears the box's walls, and where it meets them when the skirt is too narrow", async () => {
      const lid = (inside: number) =>
        [
          "from build123d import *",
          // A 50 mm box 30 high; a lid on its top with a skirt 8 mm deep round it.
          "box = Pos(0, 0, 15) * (Box(50, 50, 30) - Pos(0, 0, 2) * Box(46, 46, 30))",
          `lid = Pos(0, 0, 31) * Box(56, 56, 2) + Pos(0, 0, 26) * (Box(56, 56, 8) - Box(${inside}, ${inside}, 8))`,
          'show(box, name="Box")',
          'show(lid, name="Lid")',
        ].join("\n");
      await writeFile(
        join(root, "lid.json"),
        JSON.stringify({
          requirements: [
            { id: "R1", check: "insert", part: "Lid", along: [0, 0, -1] },
          ],
        }),
      );

      const loose = await build({ code: lid(51), requirements: "lid.json" });
      const tight = await build({ code: lid(49), requirements: "lid.json" });

      expect(text(loose)).toMatch(
        /- R1 holds: Lid goes in along -z from 9 mm out without meeting Box; it passes Box 0\.5 mm apart at the least, and sits against it at its place; 0\.5 mm to spare\./,
      );
      // The skirt's lower edge reaches the box's rim 8 mm above its place and would go 0.5 mm into each wall.
      expect(text(tight)).toMatch(
        /- R1 fails, its margin down from 0\.5 to -0\.5 mm since the last build: Lid cannot go in along -z: 8 mm short of its place it meets Box at \(-?[\d.]+, -?[\d.]+, 30\), and would go 0\.5 mm into it; 0\.5 mm past the limit\./,
      );
    }, 300_000);

    it("says a pin pressed into its bore by less than the meshes find cannot go in, as it overlaps the plate at its place", async () => {
      await writeFile(
        join(root, "press.json"),
        JSON.stringify({
          requirements: [
            { id: "R1", check: "insert", part: "Pin", along: [0, 0, -1] },
          ],
        }),
      );
      const result = await build({
        code: [
          ...plate,
          // A hundredth of a millimetre wider than the bore all round.
          "pin = Cylinder(2.31, 5)",
          'show(pin, name="Pin")',
        ].join("\n"),
        requirements: "press.json",
      });

      expect(text(result)).toContain(
        "- R1 fails: Pin cannot go in along -z: at its place it overlaps Plate, 0.01 mm into it; 0.01 mm past the limit.",
      );
    }, 180_000);

    it("runs a workspace script as __main__, so a part's module that shows its parts only when run itself can be imported by a probe of it, which shows only its own", async () => {
      await mkdir(join(root, "probe"), { recursive: true });
      await writeFile(
        join(root, "probe", "bracket.py"),
        [
          "from build123d import *",
          "bracket = Box(30, 20, 4) - Cylinder(3, 10)",
          'if __name__ == "__main__":',
          '    show(bracket, name="Bracket")',
        ].join("\n"),
      );
      await writeFile(
        join(root, "probe", "probe.py"),
        [
          "from build123d import *",
          "from bracket import bracket",
          'print("faces", len(bracket.faces()))',
          'show(extrude(bracket.faces().sort_by(Axis.Z)[-1], 1), name="Top")',
        ].join("\n"),
      );

      const whole = await build({ file: "probe/bracket.py" });
      const probe = await build({ file: "probe/probe.py" });

      expect(text(whole)).toMatch(/^Bracket: a valid solid/m);
      expect(text(probe)).toMatch(/^Top: a valid solid/m);
      expect(text(probe)).not.toContain("Bracket:");
      expect(text(probe)).toContain("faces 7");
    }, 180_000);
  },
);
