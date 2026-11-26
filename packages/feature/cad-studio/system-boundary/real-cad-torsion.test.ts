/**
 * Torque on sections that are not round, measured on the exact solids of a
 * real build123d: Saint-Venant torsion solved on each section, checked
 * against the closed forms of a round, a square and a hollow ellipse, and
 * against a far finer solve of a D-flat shaft. Skipped unless the CAD
 * environment's Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-torsion.test.ts
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

const folders = new TemporaryFolders();

/** How far `got` is from `expected`, as a share of it. */
const off = (got: number, expected: number) => Math.abs(got / expected - 1);

/** A requirement's shear, torsion constant and the point its shear is highest at, as its line says them. */
function solved(said: string, id: string) {
  const line = said.split("\n").find((one) => one.startsWith(`- ${id} `));
  const found =
    /\(shear ([\d.]+) MPa; its section there [\d.]+ mm², I [\d.]+ mm⁴, J ([\d.]+) mm⁴ from Saint-Venant torsion solved on the section in \d+ points, its shear highest at \(([-\d.e]+), ([-\d.e]+), ([-\d.e]+)\)/.exec(
      line ?? "",
    );
  if (!found) throw new Error(`No torsion solve in ${line ?? said}`);
  const [, shear, constant, x, y, z] = found.map(Number);
  return { line: line!, shear: shear!, J: constant!, at: [x!, y!, z!] };
}

describe.skipIf(!python)(
  "torque on sections that are not round, with a real build123d",
  () => {
    let root: string;
    let build: (
      folder: string,
      lines: string[],
      requirements: unknown[],
    ) => Promise<string>;

    beforeAll(async () => {
      root = await folders.make("zhiyin-real-cad-torsion-workspace-");
      const data = await folders.make("zhiyin-real-cad-torsion-data-");
      const tools = cadAutomation(await confinedPython(), {
        workspaceRoot: () => root,
        harness,
        directory: join(data, "cad-studio"),
      });
      build = async (folder, lines, requirements) => {
        await mkdir(join(root, folder), { recursive: true });
        await writeFile(join(root, folder, "part.py"), lines.join("\n"));
        await writeFile(
          join(root, folder, "requirements.json"),
          JSON.stringify({ requirements }),
        );
        const args = { file: `${folder}/part.py` };
        const asked = await tools.inspect("cad_build", args);
        if (!asked.ok) throw new Error(asked.reason);
        const result = (await tools.callTool(
          "cad_build",
          args,
          undefined,
          asked.identity,
        )) as Result;
        const said = result.content[0]?.text ?? "";
        if (result.isError) throw new Error(said);
        return said;
      };
    }, 30_000);

    afterAll(() => folders.removeAll());

    it("solves a round section to its closed form within 1%", async () => {
      // A requirement takes a round section's T·r/J; the solve itself, given
      // one, must agree with it: J = π d⁴ / 32 and τ = 16 T / (π d³).
      const script = [
        "import json, sys",
        "import numpy",
        "sys.path.insert(0, sys.argv[1])",
        "from build123d import Circle",
        "from zhiyin_cad import torsion",
        "got = torsion.section([Circle(3).face()], (0, 0, 0), numpy.array([1.0, 0, 0]), numpy.array([0, 1.0, 0]))",
        'print(json.dumps({"J": got["J"], "per": got["per_torque"]}))',
      ].join("\n");
      const { stdout } = await promisify(execFile)(
        python!,
        ["-I", "-c", script, dirname(harness)],
        { timeout: 120_000 },
      );
      const got = JSON.parse(stdout) as { J: number; per: number };

      expect(off(got.J, (Math.PI * 6 ** 4) / 32)).toBeLessThan(0.01);
      expect(off(got.per, 16 / (Math.PI * 6 ** 3))).toBeLessThan(0.01);
    }, 120_000);

    it("measures torque on a D-flat, a square, a hollow ellipse and a keyed shaft, each holding or failing with its figure", async () => {
      const said = await build(
        "shafts",
        [
          "from build123d import *",
          "def along_x(face, length=100):",
          "    return extrude(Plane.YZ * face, length / 2, both=True)",
          // Ø6 with a flat 0.5 mm deep along its top.
          'show(along_x(Circle(3) - Pos(0, 2.5 + 5) * Rectangle(20, 10)), name="DShaft")',
          'show(Pos(0, 20, 0) * Box(100, 5, 5), name="Square")',
          // Bounded by two similar ellipses, 8 × 4 and 4 × 2.
          'show(Pos(0, 40, 0) * along_x(Ellipse(4, 2) - Ellipse(2, 1)), name="Hollow")',
          // Ø6 with a keyway 2 mm wide and 1 mm deep, its inner corners sharp.
          "keyed = Circle(3) - Pos(0, 3) * Rectangle(2, 2)",
          'show(Pos(0, 60, 0) * along_x(keyed), name="Keyed")',
          // The same keyway with its inner corners rounded R0.3.
          "rounded = fillet([v for v in keyed.vertices() if abs(v.Y - 2) < 1e-6], 0.3)",
          'show(Pos(0, 80, 0) * along_x(rounded), name="Rounded")',
        ],
        [
          {
            id: "D1",
            check: "stress",
            part: "DShaft",
            along: [1, 0, 0],
            torque: 1,
            material: "steel",
            safety: 2,
          },
          {
            id: "S1",
            check: "stress",
            part: "Square",
            along: [1, 0, 0],
            torque: 2,
            yield: 100,
            safety: 2,
          },
          {
            id: "H1",
            check: "stress",
            part: "Hollow",
            along: [1, 0, 0],
            torque: 1,
            material: "steel",
            safety: 2,
          },
          {
            id: "K1",
            check: "stress",
            part: "Keyed",
            along: [1, 0, 0],
            torque: 1,
            material: "steel",
            safety: 2,
          },
          {
            id: "K2",
            check: "stress",
            part: "Rounded",
            along: [1, 0, 0],
            torque: 1,
            material: "steel",
            safety: 2,
          },
        ],
      );

      // The D-flat's reference is the same solve on about 80,000 points, twenty
      // times as many as a requirement uses: J 115.70 mm⁴ and a highest shear
      // of 0.031328 MPa per N·mm, at the middle of the flat. 1 N·m gives
      // 31.33 MPa, von Mises √3 × 31.33 = 54.3 MPa, against 235 / 2 allowed.
      const flat = solved(said, "D1");
      expect(flat.line).toMatch(/^- D1 holds: DShaft, /);
      expect(off(flat.J, 115.7)).toBeLessThan(0.005);
      expect(off(flat.shear, 31.33)).toBeLessThan(0.01);
      // Cutting the flat raises the shear above the whole 6 mm round's,
      // 16T / (π d³) = 23.58 MPa, and lowers J below π d⁴ / 32 = 127.2 mm⁴.
      expect(flat.shear).toBeGreaterThan((16 * 1000) / (Math.PI * 6 ** 3));
      expect(flat.J).toBeLessThan((Math.PI * 6 ** 4) / 32);
      expect(Math.abs(flat.at[1]!)).toBeLessThan(0.3);
      expect(flat.at[2]).toBeCloseTo(2.5, 2);

      // A square of side a: J = 0.1406 a⁴ = 87.88 mm⁴ and τ = T / (0.208 a³)
      // = 76.92 MPa for 2 N·m (Timoshenko & Goodier, §109); von Mises 133 MPa
      // against 100 / 2 allowed.
      const square = solved(said, "S1");
      expect(square.line).toMatch(
        /^- S1 fails: Square, [^\n]*MPa past the limit\.$/,
      );
      expect(off(square.J, 0.1406 * 5 ** 4)).toBeLessThan(0.02);
      expect(off(square.shear, 2000 / (0.208 * 5 ** 3))).toBeLessThan(0.02);

      // Between similar ellipses of semi-axes a, b and k a, k b: J = π a³ b³ /
      // (a² + b²) (1 − k⁴) = 75.40 mm⁴ and τ = 2 T / (π a b² (1 − k⁴)) =
      // 42.44 MPa, at the ends of the outer minor axis (Timoshenko & Goodier,
      // §115), so the hole's constant is right.
      const hollow = solved(said, "H1");
      expect(hollow.line).toMatch(/^- H1 holds: Hollow, /);
      expect(
        off(hollow.J, ((Math.PI * 64 * 8) / 20) * (1 - 0.5 ** 4)),
      ).toBeLessThan(0.01);
      expect(
        off(hollow.shear, 2000 / (Math.PI * 16 * (1 - 0.5 ** 4))),
      ).toBeLessThan(0.01);
      expect(Math.abs(hollow.at[2]!)).toBeCloseTo(2, 1);

      // A sharp inner corner has no finite peak of shear; the answer says how
      // much about it was left out, and how to have it measured.
      expect(solved(said, "K1").line).toMatch(
        /^- K1 holds: Keyed, [^\n]*, leaving out the 0\.\d+ mm about its sharp inner corners, where the shear has no finite peak; give them a radius to have them measured[,)]/,
      );

      // Rounded, they are measured: the shear gathers in the rounds, 50.44 MPa
      // by the same solve on about 80,000 points, twice the 23.6 MPa of the
      // plain Ø6 shaft, as a keyway's stress concentration is.
      const rounded = solved(said, "K2");
      expect(rounded.line).not.toContain("sharp inner corners");
      expect(rounded.line).not.toContain("still changing");
      expect(off(rounded.shear, 50.44)).toBeLessThan(0.01);
      expect(rounded.at[2]).toBeGreaterThan(1.99);
      expect(rounded.at[2]).toBeLessThan(2.3);
    }, 300_000);
  },
);
