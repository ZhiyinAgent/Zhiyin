/**
 * The strength helpers and ISO 286 fits a script is given, and how the
 * gears a build shows mesh, run in a real build: each says its checks under
 * what the helpers did, measured against its limit with the margin, and
 * each figure is the one worked by hand from the formula its description
 * names. Skipped unless the CAD environment's
 * Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-strength.test.ts
 */

import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { engineeringHelpers } from "../src/script-helpers.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

const folders = new TemporaryFolders();

describe.skipIf(!python)(
  "strength checks and fits in a script, with a real build123d",
  () => {
    let run: (name: string, args: Record<string, unknown>) => Promise<Result>;
    const text = (result: Result) => result.content[0]?.text ?? "";
    const build = (lines: string[]) =>
      run("cad_build", {
        code: ["from build123d import *", ...lines].join("\n"),
      });

    beforeAll(async () => {
      const root = await folders.make("zhiyin-real-cad-strength-");
      const data = await folders.make("zhiyin-real-cad-strength-data-");
      const tools = cadAutomation(await confinedPython(), {
        workspaceRoot: () => root,
        harness,
        directory: join(data, "cad-studio"),
      });
      run = async (name, args) => {
        const asked = await tools.inspect(name, args);
        if (!asked.ok) throw new Error(asked.reason);
        return (await tools.callTool(
          name,
          args,
          undefined,
          asked.identity,
        )) as Result;
      };
    }, 30_000);

    afterAll(() => folders.removeAll());

    it("checks a shaft and a beam by their stresses and deflection against the yield of the material named", async () => {
      const result = await build([
        "strength.shaft(20, torque=50, moment=30)",
        "strength.shaft(20, torque=50, length=200, load=600, max_deflection=0.1, max_twist=0.5)",
        "strength.beam(1000, 2000, width=40, height=80, max_deflection=0.1)",
      ]);
      const said = text(result);

      expect(result.isError, said).toBeUndefined();
      // Ø20 solid: πd³/32 = 785.4 mm³. 30 N·m bends it by 30000 / 785.4 =
      // 38.2 MPa, 50 N·m twists it by 50000 / 1570.8 = 31.8 MPa; von Mises
      // √(38.2² + 3 × 31.8²) = 67.1 MPa; S235's 235 MPa yield over it, 3.50.
      expect(said).toContain(
        "- strength.shaft: Ø20 mm solid steel shaft (S235JR, up to 16 mm thick: yield 235 MPa), 50 N·m torque, 30 N·m bending: bending 38.2 MPa, torsion 31.8 MPa, von Mises 67.1 MPa. Safety factor against yield 3.5, where at least 2 is asked: holds, 1.5 to spare. Static only: no fatigue, and no stress raised at shoulders, keyways or grooves.",
      );
      // 600 N midway between bearings 200 mm apart bends it F·L/4 = 30 N·m,
      // the same stresses; it sags F·L³/(48 E I) = 600 × 200³ / (48 × 210000
      // × 7854) = 0.0606 mm and twists T·L/(G J) = 50000 × 200 / (81000 ×
      // 15708) rad = 0.45°.
      expect(said).toContain(
        "- strength.shaft: Ø20 mm solid steel shaft (S235JR, up to 16 mm thick: yield 235 MPa), 50 N·m torque, 30 N·m bending: bending 38.2 MPa, torsion 31.8 MPa, von Mises 67.1 MPa, deflection 0.0606 mm, twist 0.45°. Safety factor against yield 3.5, where at least 2 is asked: holds, 1.5 to spare; deflection 0.0606 mm, where at most 0.1 mm is asked: holds, 0.0394 mm to spare; twist 0.45°, where at most 0.5° is asked: holds, 0.0497° to spare.",
      );
      // 40 × 80 on two supports 1 m apart, 2000 N at its middle: M = F·L/4 =
      // 500 N·m, I = 40 × 80³ / 12 = 1706667 mm⁴, σ = M·c/I = 11.7 MPa,
      // δ = F·L³/(48 E I) = 0.116 mm, past the 0.1 mm asked.
      expect(said).toContain(
        "- strength.beam: 1000 mm simple steel beam, 40 mm wide, 80 mm deep rectangle (S235JR, up to 16 mm thick: yield 235 MPa, E 210 GPa), 2000 N at its middle: moment 500 N·m, stress 11.7 MPa, deflection 0.116 mm. Safety factor against yield 20.1, where at least 2 is asked: holds, 18.1 to spare; deflection 0.116 mm, where at most 0.1 mm is asked: fails, 0.0163 mm past the limit. Elastic and static: no local buckling, no shear deflection.",
      );
    }, 120_000);

    it("checks a bolt by Eurocode 3, a bearing's L10 life from the catalogue's C, a gear tooth by Lewis and a column by Euler or Johnson", async () => {
      const said = text(
        await build([
          'strength.bolt("M8", "8.8", shear=5000, tension=3000, joint="slip")',
          'strength.bolt("M8", "8.8", shear=5000)',
          "strength.bearing(C=13800, P=1200, rpm=1500, hours=20000)",
          "strength.gear(2, 20, 20, 30, rpm=1000)",
          "strength.column(1200, 20000, diameter=30)",
          "strength.column(200, 20000, diameter=30)",
        ]),
      );

      // As = π/4 (8 − 0.9382 × 1.25)² = 36.6 mm²; preload 0.7 × 800 × As =
      // 20500 N; shear 0.6 × 800 × As / 1.25 = 14100 N; tension 0.9 × 800 ×
      // As / 1.25 = 21100 N; slip 0.3 × 20500 / 1.25 = 4920 N, which 5000 N
      // passes; together 5000/14058 + 3000/(1.4 × 21086) = 0.457.
      expect(said).toContain(
        "- strength.bolt: M8 grade 8.8 bolt (fub 800 MPa), stress area 36.6 mm², preload 20500 N at 32.8 N·m tightening; resists 14100 N in shear over 1 plane, 21100 N in tension, slip at 4920 N with μ 0.3. Shear 5000 N, where at most 14100 N is asked: holds, 9060 N to spare; shear against slip of the preloaded joint 5000 N, where at most 4920 N is asked: fails, 79.8 N past the limit; tension 3000 N, where at most 21100 N is asked: holds, 18100 N to spare; shear and tension together 0.457, where at most 1 is asked: holds, 0.543 to spare.",
      );
      // A bearing joint, as a bolt is unless said to be slip-resistant, takes
      // its shear on the bolt's shank: its slip is no limit of it.
      expect(said).toContain(
        "- strength.bolt: M8 grade 8.8 bolt (fub 800 MPa), stress area 36.6 mm², preload 20500 N at 32.8 N·m tightening; resists 14100 N in shear over 1 plane, 21100 N in tension, slip at 4920 N with μ 0.3. Shear 5000 N, where at most 14100 N is asked: holds, 9060 N to spare.",
      );
      // (13800 / 1200)³ = 1521 million turns, over 60 × 1500 per hour: 16900 h.
      expect(said).toContain(
        "- strength.bearing: ball bearing, C 13800 N under P 1200 N at 1500 rpm: L10 1520 million turns, 16900 h. L10 life 16900 h, where at least 20000 h is asked: fails, 3100 h past the limit. ISO 281 basic rating life, 90% reliability, no life modification for lubrication or contamination.",
      );
      // Ft = 2 × 30000 / 40 = 1500 N; V = π × 0.04 × 1000 / 60 = 2.09 m/s,
      // Kv = (6.1 + 2.09) / 6.1 = 1.34; σ = 1.34 × 1500 / (20 × 2 × 0.322) = 156 MPa.
      expect(said).toContain(
        "- strength.gear: m2 z20 gear 20 mm wide in steel (S235JR, up to 16 mm thick: yield 235 MPa), 30 N·m: pitch Ø40 mm, tip Ø44 mm, tooth force 1500 N, Y 0.322, Kv 1.34 at 2.09 m/s, root stress 156 MPa. Safety factor against yield 1.5, where at least 2 is asked: fails, 0.498 past the limit. Lewis bending only: no contact stress, no load sharing between teeth.",
      );
      // Ø30: r = 7.5 mm. 1200 / 7.5 = 160, past √(2π² E / Sy) = 133, so
      // Euler: π² × 210000 × 39761 / 1200² = 57200 N.
      expect(said).toContain(
        "- strength.column: 1200 mm steel column, Ø30 mm solid, ends pinned (K 1), 20000 N: slenderness 160 against 133 where Euler's takes over, critical load 57200 N by Euler. Safety factor against buckling 2.86, where at least 2 is asked: holds, 0.861 to spare.",
      );
      // 200 / 7.5 = 26.7, short: Johnson, 706.9 × (235 − (235 × 200 / (2π × 7.5))² / 210000) = 163000 N.
      expect(said).toContain(
        "- strength.column: 200 mm steel column, Ø30 mm solid, ends pinned (K 1), 20000 N: slenderness 26.7 against 133 where Euler's takes over, critical load 163000 N by Johnson. Safety factor against buckling 8.14, where at least 2 is asked: holds, 6.14 to spare.",
      );
    }, 120_000);

    it("refuses a material it has no figures for, saying to give them", async () => {
      const result = await build([
        'strength.shaft(10, torque=5, material="PLA")',
      ]);

      expect(result.isError).toBe(true);
      expect(text(result)).toContain(
        "there are no strength figures for 'PLA' here: give yield_strength= and modulus= in MPa from its datasheet, or a material of steel, stainless steel, aluminium, titanium",
      );
      const given = text(
        await build([
          'strength.shaft(10, torque=5, material="PLA", yield_strength=50, modulus=3500)',
        ]),
      );
      // 16 × 5000 / (π × 1000) = 25.5 MPa, √3 × 25.5 = 44.1 MPa against 50.
      expect(given).toContain(
        "- strength.shaft: Ø10 mm solid PLA shaft (PLA: yield 50 MPa), 5 N·m torque, 0 N·m bending: bending 0 MPa, torsion 25.5 MPa, von Mises 44.1 MPa. Safety factor against yield 1.13, where at least 2 is asked: fails, 0.866 past the limit.",
      );
    }, 120_000);

    it("gives ISO 286 limits of a hole, a shaft and a fit, and whether the fit clears or grips", async () => {
      const said = text(
        await build([
          'print(iso_fit("H7/g6", 25).hole.middle)',
          'iso_fit("H7/p6", 25)',
          'iso_fit("H7/k6", 25)',
          'iso_fit("S7", 60)',
          'iso_fit("M6", 300)',
        ]),
      );

      // 18–30 mm: IT7 21 µm, IT6 13 µm; g's es −7 µm, p's ei +22 µm, k's +2 µm.
      expect(said).toContain(
        "- iso_fit H7/g6 at Ø25: hole H7 25.000 to 25.021 mm (0 / +21 µm); shaft g6 24.980 to 24.993 mm (-20 / -7 µm); clearance +0.007 to +0.041 mm, below zero an interference: a clearance fit.",
      );
      expect(said).toContain(
        "- iso_fit H7/p6 at Ø25: hole H7 25.000 to 25.021 mm (0 / +21 µm); shaft p6 25.022 to 25.035 mm (+22 / +35 µm); clearance -0.035 to -0.001 mm, below zero an interference: an interference fit.",
      );
      expect(said).toContain(
        "- iso_fit H7/k6 at Ø25: hole H7 25.000 to 25.021 mm (0 / +21 µm); shaft k6 25.002 to 25.015 mm (+2 / +15 µm); clearance -0.015 to +0.019 mm, below zero an interference: a transition fit.",
      );
      // A hole's S to IT7: ES = −ei + Δ = −53 + (30 − 19) = −42 µm at 50–65 mm.
      expect(said).toContain(
        "- iso_fit S7 at Ø60: hole S7 59.928 to 59.958 mm (-72 / -42 µm).",
      );
      // ISO 286-1's one exception: M6 from 250 to 315 mm has ES −9 µm.
      expect(said).toContain(
        "- iso_fit M6 at Ø300: hole M6 299.959 to 299.991 mm (-41 / -9 µm).",
      );
      expect(said).toContain("25.0105");
    }, 120_000);

    it("looks up each engineering helper the tools name, and a strength check's inputs by name", async () => {
      const said = text(
        await run("cad_api", {
          names: [...engineeringHelpers, "strength.bearing"],
        }),
      );

      // Every one the tools name is one the harness gives.
      for (const name of engineeringHelpers)
        expect(said).toMatch(
          new RegExp(`^${name}\\(.*\\): a helper given to scripts`, "m"),
        );
      expect(said).toMatch(/Its own methods: .*bearing\(C, P, rpm/);
      expect(said).toContain(
        "strength.bearing(C, P, rpm, kind='ball', hours=None): a helper given to scripts, with no import",
      );
      expect(said).toContain(
        "bd_warehouse's bearings have their\nsizes and no load ratings",
      );
      expect(said).toMatch(
        /sheet\(outline, thickness, bends=\(\), radius=None, k=None, relief=True, fixed=None\): a helper given to scripts/,
      );
      expect(said).toMatch(/iso_fit\(fit, size\): a helper given to scripts/);
    }, 120_000);

    it("says how two gears shown mesh: their centre distance, the backlash it opens and their contact ratio", async () => {
      const result = await build([
        "from bd_warehouse.gear import SpurGear",
        'show(SpurGear(module=1.5, tooth_count=20, pressure_angle=20, thickness=8), name="Pinion")',
        'show(Pos(1.5 * (20 + 30) / 2 + 0.15, 0, 0) * Rot(Z=180 + 180 / 30) * SpurGear(module=1.5, tooth_count=30, pressure_angle=20, thickness=8), name="Wheel")',
        'show(Pos(-35, 0, 0) * SpurGear(module=2, tooth_count=20, pressure_angle=20, thickness=8), name="Odd")',
        "from bd_warehouse.gear import HelicalGear",
        "left = HelicalGear(module=1.5, tooth_count=20, pressure_angle=20, helix_angle=20, thickness=8)",
        "right = HelicalGear(module=1.5, tooth_count=30, pressure_angle=20, helix_angle=-20, thickness=8)",
        'show(Pos(0, 100, 0) * left, name="Left")',
        'show(Pos(left.pitch_radius + right.pitch_radius, 100, 0) * right, name="Right")',
      ]);
      const said = text(result);

      expect(result.isError, said).toBeUndefined();
      // m 1.5, z 20 and 30 at 20°: base radii 14.095 and 21.143 mm, tips
      // 16.5 and 24 mm. 37.65 mm apart, cos αw = 35.238 / 37.65, αw =
      // 20.62°; ε = (√(16.5² − 14.095²) + √(24² − 21.143²) − 37.65 sin αw)
      // / (2π 14.095 / 20) = 1.51. The 0.15 mm opens 2 × 0.15 × tan αw =
      // 0.113 mm of backlash.
      expect(said).toContain(
        "Pinion (20 teeth) and Wheel (30 teeth) mesh 37.65 mm apart, 0.15 mm wider than where their pitch circles meet (37.5 mm), about 0.113 mm of backlash from that alone: contact ratio 1.51 at a working pressure angle of 20.62°.",
      );
      // A module 2 gear beside the module 1.5 pinion: base pitches 2π 14.095
      // / 20 = 4.43 mm and 2π 18.794 / 20 = 5.9 mm.
      expect(said).toContain(
        "Pinion (20 teeth) and Odd (20 teeth) reach into each other 35 mm apart but cannot mesh: their base pitches differ, 4.43 and 5.9 mm, so their modules or pressure angles do.",
      );
      // Transverse figures at 20° normal and 20° helix: αt = 21.17°, ε =
      // 1.48; overlap b sin β / (π mn) = 8 sin 20° / (1.5 π) = 0.581.
      expect(said).toContain(
        "Left (20 teeth) and Right (30 teeth) mesh 39.91 mm apart, where their pitch circles meet: contact ratio 1.48 at a working pressure angle of 21.17°, and an overlap ratio of 0.581 along their 8 mm width, 2.06 in all.",
      );
    }, 120_000);

    it("says how gears mesh once bored, moved onto their shafts and joined into a compound gear, pairing only those side by side", async () => {
      // A two-stage train along y, as a gearbox is built: each gear bored
      // for its shaft, the idler a 36-tooth gear and a 12-tooth pinion
      // joined by a web, each stage 0.15 mm wider than its pitch circles.
      const result = await build([
        "from bd_warehouse.gear import SpurGear",
        "def gear(z, x, y0, phase=0.0):",
        "    g = SpurGear(module=1, tooth_count=z, pressure_angle=25, thickness=8)",
        "    return Pos(x, y0 + 4, 0) * (Rot(X=-90) * (Rot(Z=phase) * g))",
        "def bore(x, r):",
        "    return Pos(x, -10, 0) * (Rot(X=-90) * Cylinder(r, 60, align=(Align.CENTER, Align.CENTER, Align.MIN)))",
        'show(gear(12, -0.15, 6.8) - bore(-0.15, 1.6), name="Pinion")',
        "web = Pos(24, 16.8, 0) * (Rot(X=-90) * Cylinder(4.5, 4))",
        'show(gear(36, 24, 6.8, 185) + web + gear(12, 24, 18.8) - bore(24, 2.1), name="Idler")',
        'show(gear(48, 54.15, 18.8, 183.75) - bore(54.15, 3.1), name="Wheel")',
      ]);
      const said = text(result);

      expect(result.isError, said).toBeUndefined();
      // m 1 at 25°: base radii 12 × cos 25° / 2 = 5.438 and 16.314 mm, tips
      // 7 and 19 mm. 24.15 mm apart, cos αw = 21.751 / 24.15, αw = 25.75°;
      // backlash 2 × 0.15 × tan αw = 0.145 mm; ε = (√(7² − 5.438²) +
      // √(19² − 16.314²) − 24.15 sin αw) / (2π 5.438 / 12) = 1.28.
      expect(said).toContain(
        "Pinion (12 teeth) and Idler (36 teeth) mesh 24.15 mm apart, 0.15 mm wider than where their pitch circles meet (24 mm), about 0.145 mm of backlash from that alone: contact ratio 1.28 at a working pressure angle of 25.75°.",
      );
      expect(said).toMatch(
        /Idler \(12 teeth\) and Wheel \(48 teeth\) mesh 30\.15 mm apart, 0\.15 mm wider than where their pitch circles meet \(30 mm\), about 0\.14\d mm of backlash from that alone: contact ratio 1\.\d+ at a working pressure angle of 25\.\d+°\./,
      );
      // The pinion lies beside the idler's 36 teeth, not its 12.
      expect(said).not.toMatch(/Pinion \(12 teeth\) and Idler \(12 teeth\)/);
      expect(said).not.toMatch(/Pinion \(12 teeth\) and Wheel/);
    }, 120_000);
  },
);
