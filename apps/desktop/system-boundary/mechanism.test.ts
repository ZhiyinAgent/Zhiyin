// @vitest-environment node
/**
 * A mechanism carried from the CAD studio to the 3D studio, as the composition
 * joins them: parts built about their own axes from a layout file, checked
 * for overlaps through their motion, exported as one model, brought into the
 * conversation's Blender, the driving part keyed and another following it,
 * and the assembly drawn from the same scripts.
 *
 * Each studio's own tests prove its side. This one proves the hand-over: a
 * part placed by a move arrives turning about its own axis, and the parts a
 * script names are the objects Blender animates. Skipped unless both
 * programs are named in the environment, as their own suites are:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"
 *   npx vitest run --project "system-boundary*" apps/desktop/system-boundary/mechanism.test.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
} from "@zhiyin/blender-studio";
import { withKeptGlCache } from "@zhiyin/blender-studio/testing";
import { cadAutomation } from "@zhiyin/cad-studio";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { confinedCadPython } from "./cad-python.js";

const blender = process.env["ZHIYIN_BLENDER"];
const python = process.env["ZHIYIN_CAD_PYTHON"];
const session = fileURLToPath(
  new URL(
    "../../../packages/feature/blender-studio/src/session/start.py",
    import.meta.url,
  ),
);
const harness = fileURLToPath(
  new URL(
    "../../../packages/feature/cad-studio/src/harness/run.py",
    import.meta.url,
  ),
);

type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};
type Tools = {
  inspect: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ ok: boolean; reason?: string; identity?: string }>;
  callTool: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    identity?: string,
  ) => Promise<unknown>;
};

// A shaft turning in two bearing blocks on a base, a disc fixed on it with a
// hole off its axis; each part about its own axis, in its own module.
const files = {
  "layout.py": [
    "# The mechanism's key sizes, in millimetres.",
    "SHAFT_HEIGHT = 150  # the shaft's axis above the base's underside",
    "SHAFT_DIAMETER = 10",
    "BORE_CLEARANCE = 0.2  # a side, where the shaft turns in a block",
    "BLOCKS_AT = (-60, 60)  # along the shaft",
    "DISC_DIAMETER = 80",
    "DISC_THICKNESS = 10",
    "PIN_RADIUS = 25",
    "BASE = (200, 100, 10)",
  ],
  "parts.py": [
    "from build123d import *",
    "from layout import *",
    "",
    "def base():",
    "    return Box(*BASE, align=(Align.CENTER, Align.CENTER, Align.MIN))",
    "",
    "def block():",
    "    # Its bore along x through its origin; its foot on the base's top.",
    "    height = SHAFT_HEIGHT - BASE[2] + 20",
    "    with BuildPart() as b:",
    "        with Locations((0, 0, 20 - height / 2)):",
    "            Box(20, 40, height)",
    "        Cylinder(SHAFT_DIAMETER / 2 + BORE_CLEARANCE, 40, rotation=(0, 90, 0), mode=Mode.SUBTRACT)",
    "    return b.part",
    "",
    "def shaft():",
    "    with BuildPart() as s:",
    "        Cylinder(SHAFT_DIAMETER / 2, 180, rotation=(0, 90, 0))",
    "    return s.part",
    "",
    "def disc():",
    "    with BuildPart() as d:",
    "        Cylinder(DISC_DIAMETER / 2, DISC_THICKNESS, rotation=(0, 90, 0))",
    "        Cylinder(SHAFT_DIAMETER / 2, DISC_THICKNESS, rotation=(0, 90, 0), mode=Mode.SUBTRACT)",
    "        with Locations((0, PIN_RADIUS, 0)):",
    "            Cylinder(4, DISC_THICKNESS, rotation=(0, 90, 0), mode=Mode.SUBTRACT)",
    "    return d.part",
  ],
  "assembly.py": [
    "import sys",
    "from build123d import *",
    "from layout import *",
    "from parts import base, block, disc, shaft",
    "",
    "# The shaft's turn in degrees, to check the parts clear each other as it turns.",
    "turn = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0",
    "axis = Location((0, 0, SHAFT_HEIGHT))",
    'show(base(), name="Base")',
    'show([block().moved(Location((x, 0, SHAFT_HEIGHT))) for x in BLOCKS_AT], name="Block")',
    'show(shaft().rotate(Axis.X, turn).moved(axis), name="Shaft")',
    'show(disc().rotate(Axis.X, turn).moved(axis), name="Disc")',
  ],
};

describe.runIf(blender && python)(
  "a mechanism from the CAD studio in the 3D studio",
  () => {
    const folders = new TemporaryFolders();
    let workspace: string;
    let scenes: ConversationScenes;
    let studio: ReturnType<typeof sceneAutomation>;
    let cad: ReturnType<typeof cadAutomation>;
    const said = (result: Result) =>
      result.content.map((c) => c.text ?? "").join("\n");
    const call = async (
      tools: Tools,
      name: string,
      args: Record<string, unknown>,
    ) => {
      const asked = await tools.inspect(name, args);
      if (!asked.ok) throw new Error(asked.reason);
      return (await tools.callTool(
        name,
        args,
        undefined,
        asked.identity,
      )) as Result;
    };

    beforeAll(async () => {
      const root = await folders.make("zhiyin-mechanism-");
      workspace = join(root, "workspace");
      await mkdir(workspace, { recursive: true });
      for (const [name, lines] of Object.entries(files))
        await writeFile(join(workspace, name), lines.join("\n") + "\n");
      scenes = new ConversationScenes({
        blender: async () => blender,
        directory: join(root, "data", "scenes"),
        launch: withKeptGlCache(containedSessionLaunch)(
          { open: openProcessContainer },
          { scripts: join(root, "session-scripts") },
        ),
        script: session,
      });
      studio = sceneAutomation(scenes.scene("mechanism"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("mechanism"),
      });
      cad = cadAutomation(
        await confinedCadPython(python!, "python-mechanism-test"),
        {
          workspaceRoot: () => workspace,
          harness,
          directory: join(root, "data", "cad-studio"),
        },
      );
    }, 60_000);

    afterAll(async () => {
      await scenes.forget("mechanism");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("builds the assembly from its files, clear of itself as the shaft turns, and exports it", async () => {
      const built = await call(cad, "cad_build", {
        file: "assembly.py",
        exports: [{ path: "mechanism.glb" }],
      });
      const turned = await Promise.all(
        ["45", "90", "135"].map((turn) =>
          call(cad, "cad_build", { file: "assembly.py", arguments: [turn] }),
        ),
      );

      expect(built.isError, said(built)).toBeUndefined();
      expect(said(built)).toContain("mechanism.glb");
      for (const result of [built, ...turned]) {
        expect(result.isError, said(result)).toBeUndefined();
        expect(said(result)).not.toContain("overlap by");
      }
    }, 300_000);

    it("turns each part about its own axis in the 3D studio, from where it was modelled, the disc following the keyed shaft", async () => {
      const opened = await call(studio, "blender_open_scene", {
        path: "mechanism.blend",
        create: true,
      });
      const added = await call(studio, "blender_add_objects", {
        // Standing on the floor, as the base stood on z = 0 in CAD.
        objects: [
          {
            name: "Mechanism",
            kind: "model",
            path: "mechanism.glb",
            rest_on: "floor",
          },
        ],
      });
      const described = await call(studio, "blender_describe_scene", {});
      const animated = await call(studio, "blender_animate", {
        duration: 1,
        keys: [
          { object: "Shaft", at: 0, rotation: [0, 0, 0] },
          { object: "Shaft", at: 1, rotation: [360, 0, 0], easing: "linear" },
        ],
        follow: [
          {
            object: "Disc",
            value: "turn",
            axis: "x",
            from: { object: "Shaft", value: "turn", axis: "x" },
          },
        ],
      });
      // Where the disc's origin is, its turn, and the heights of its lowest and
      // highest points, at each quarter of a turn.
      const sampled = await call(studio, "blender_run_script", {
        code: [
          "import bpy, math",
          "s = bpy.context.scene",
          "d = bpy.data.objects['Disc']",
          "for t in (0, 0.25, 0.5, 0.75):",
          "    s.frame_set(s.frame_start + round(t * s.render.fps))",
          "    zs = [(d.matrix_world @ v.co).z * 1000 for v in d.data.vertices]",
          "    o = d.matrix_world.translation * 1000",
          "    # The hole off the axis, 25 mm out at +y in CAD, turned with the disc.",
          "    a = math.radians(t * 360)",
          "    hy, hz = 25 * math.cos(a), 150 + 25 * math.sin(a)",
          "    ring = [w for w in ((d.matrix_world @ v.co) * 1000 for v in d.data.vertices) if abs(math.hypot(w.y - hy, w.z - hz) - 4) < 0.05]",
          "    print('at', t, 'origin', round(o.x, 2), round(o.y, 2), round(o.z, 2), 'turn', round(math.degrees(d.rotation_euler.x), 2), 'low', round(min(zs), 2), 'high', round(max(zs), 2), 'hole', len(ring))",
          "s.frame_set(s.frame_start)",
        ].join("\n"),
      });

      for (const step of [opened, added, described, animated])
        expect(step.isError, said(step)).toBeUndefined();
      // Each part arrives unturned in the world, in the model's own group.
      const disc = said(described)
        .split("\n")
        .find((line) => line.startsWith("- Disc:"));
      expect(disc, said(described)).toContain("attached to Mechanism");
      expect(disc).not.toContain("turned");
      for (const [t, turn] of [
        [0, 0],
        [0.25, 90],
        [0.5, 180],
        [0.75, 270],
      ] as const) {
        const found = new RegExp(
          `at ${t} origin (\\S+) (\\S+) (\\S+) turn (\\S+) low (\\S+) high (\\S+) hole (\\S+)`,
        ).exec(said(sampled));
        expect(found, said(sampled)).not.toBeNull();
        const [x, y, z, turned, low, high, hole] = found!.slice(1).map(Number);
        // On its axis 150 mm up, turned a quarter more each time, the 80 mm
        // disc still reaching 110 to 190 mm: it turns about its own axis, not
        // about the scene's origin.
        expect([x, y, z]).toEqual([
          expect.closeTo(0, 1),
          expect.closeTo(0, 1),
          expect.closeTo(150, 1),
        ]);
        expect(turned).toBeCloseTo(turn, 1);
        expect(low).toBeCloseTo(110, 0);
        expect(high).toBeCloseTo(190, 0);
        // The hole is where the turn from its modelled place puts it.
        expect(hole, `at ${t}`).toBeGreaterThan(8);
      }
    }, 300_000);

    it("draws the assembly from the same scripts, measured on its parts", async () => {
      const drawn = await call(cad, "cad_draw", {
        file: "assembly.py",
        views: [{ view: "front" }, { view: "right" }],
        dimensions: [
          {
            view: "front",
            kind: "length",
            from: [-100, -50, 0],
            to: [100, -50, 0],
            expect: 200,
          },
          { view: "right", kind: "diameter", at: [0, 0, 190], expect: 80 },
        ],
        outputs: [{ path: "assembly.pdf" }],
      });

      expect(drawn.isError, said(drawn)).toBeUndefined();
      expect(said(drawn)).toContain("Dimensions on front: 200.");
      expect(said(drawn)).toContain("Dimensions on right: Ø80.");
    }, 300_000);

    it("gives the parts in the scene their new shapes from the next export, keeping their motion, attachment and material", async () => {
      // The disc made larger in the layout, the assembly exported again.
      await writeFile(
        join(workspace, "layout.py"),
        files["layout.py"]
          .join("\n")
          .replace("DISC_DIAMETER = 80", "DISC_DIAMETER = 90") + "\n",
      );
      const built = await call(cad, "cad_build", {
        file: "assembly.py",
        exports: [{ path: "mechanism_v2.glb" }],
      });
      const dressed = await call(studio, "blender_run_script", {
        code: [
          "import bpy",
          "brass = bpy.data.materials.new('Brass')",
          "disc = bpy.data.objects['Disc']",
          "disc.data.materials.clear()",
          "disc.data.materials.append(brass)",
          "print('objects before', len(bpy.data.objects))",
        ].join("\n"),
      });
      const reshaped = await call(studio, "blender_edit_objects", {
        edits: [{ object: "Mechanism", shapes_from: "mechanism_v2.glb" }],
      });
      const sampled = await call(studio, "blender_run_script", {
        code: [
          "import bpy, math",
          "s = bpy.context.scene",
          "d = bpy.data.objects['Disc']",
          "s.frame_set(s.frame_start + round(0.25 * s.render.fps))",
          "zs = [(d.matrix_world @ v.co).z * 1000 for v in d.data.vertices]",
          "print('turn', round(math.degrees(d.rotation_euler.x), 2), 'low', round(min(zs), 2), 'high', round(max(zs), 2))",
          "print('parent', d.parent.name, 'material', [m.name for m in d.data.materials])",
          "print('objects after', len(bpy.data.objects))",
          "s.frame_set(s.frame_start)",
        ].join("\n"),
      });

      for (const step of [built, dressed, reshaped, sampled])
        expect(step.isError, said(step)).toBeUndefined();
      expect(said(reshaped)).toContain(
        "Mechanism: new shapes from mechanism_v2.glb for Base, Block 1, Block 2, Disc and Shaft, each keeping its place, turn, attachment, materials and motion; Disc changed from ",
      );
      // The sizes the CAD measured on the exact disc, not its faceted mesh.
      expect(said(reshaped)).toContain(
        "Disc changed from 10 × 80 × 80 mm to 10 × 90 × 90 mm.",
      );
      // A quarter of the way through, the disc follows the shaft a quarter
      // turn round, now 90 mm across about the same axis.
      const found = /turn (\S+) low (\S+) high (\S+)/.exec(said(sampled));
      expect(found, said(sampled)).not.toBeNull();
      const [turned, low, high] = found!.slice(1).map(Number);
      expect(turned).toBeCloseTo(90, 1);
      expect(low).toBeCloseTo(105, 0);
      expect(high).toBeCloseTo(195, 0);
      expect(said(sampled)).toContain("parent Mechanism material ['Brass']");
      // Nothing of the new file is left behind in the scene.
      const before = /objects before (\d+)/.exec(said(dressed))?.[1];
      expect(said(sampled)).toContain(`objects after ${before}`);
    }, 300_000);
  },
);
