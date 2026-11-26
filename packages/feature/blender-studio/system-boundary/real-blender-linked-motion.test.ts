/**
 * Parts that move with others against a real Blender: a pulley turning at a
 * ratio of a crank's turn, past a whole turn, and a piston whose height is a
 * formula of the crank's angle, seen on a frame sheet as the model sees it,
 * and a rod kept between them by an aim.
 * What cannot be followed is refused in words, and clearing a part stops it.
 *
 * Skipped unless Blender is named in the environment, as the main real-Blender
 * suite is:
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
import { openProcessContainer } from "@zhiyin/sandbox";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
} from "../src/index.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string }[];
};

/** A crank 40 mm in radius driving a piston on a rod 150 mm long: the piston pin's height above the crank's axis. */
const pistonAt = (degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  return 0.04 * Math.cos(a) + Math.sqrt(0.15 ** 2 - (0.04 * Math.sin(a)) ** 2);
};
const pistonFormula =
  "0.04*cos(radians(v)) + sqrt(pow(0.15, 2) - pow(0.04*sin(radians(v)), 2))";

describe.runIf(blender)("a real Blender, moving parts with others", () => {
  const folders = new TemporaryFolders();
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  /** Each named object's turn around x in degrees and height in mm, at each time. */
  const sampled = async (names: string[], times: number[]) =>
    (
      await call("blender_run_script", {
        code: [
          "import bpy, math",
          "s = bpy.context.scene",
          `for t in ${JSON.stringify(times)}:`,
          "    s.frame_set(s.frame_start + round(t * s.render.fps))",
          `    for n in ${JSON.stringify(names)}:`,
          "        o = bpy.data.objects[n]",
          "        print('at', t, n, 'turn', round(math.degrees(o.rotation_euler.x), 3), 'height', round(o.matrix_world.translation.z * 1000, 3))",
          "s.frame_set(s.frame_start)",
        ].join("\n"),
      })
    ).said;
  const valueAt = (said: string, time: number, name: string, what: string) =>
    Number(
      new RegExp(`at ${time} ${name} turn (-?[0-9.]+) height (-?[0-9.]+)`).exec(
        said,
      )?.[what === "turn" ? 1 : 2],
    );

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-linked-");
    workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: withKeptGlCache(containedSessionLaunch)(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("linked"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("linked"),
    });
    await call("blender_open_scene", { path: "engine.blend", create: true });
    // A crank arm on an axle along x at the origin, a pulley beside it on
    // the same axis, and a piston above; the crank turns twice in 2 s, evenly.
    const added = await call("blender_add_objects", {
      objects: [
        { name: "Crank", kind: "cube", size: [0.02, 0.1, 0.02] },
        {
          name: "Pulley",
          kind: "cube",
          size: [0.01, 0.05, 0.05],
          location: [0.2, 0, 0],
        },
        {
          name: "Piston",
          kind: "cylinder",
          size: [0.05, 0.05, 0.04],
          location: [0, 0, 0.19],
        },
      ],
    });
    const turning = await call("blender_animate", {
      duration: 2,
      keys: [
        { object: "Crank", at: 0, rotation: [0, 0, 0] },
        { object: "Crank", at: 2, rotation: [720, 0, 0], easing: "linear" },
      ],
    });
    expect(added.isError, added.said).toBeUndefined();
    expect(turning.isError, turning.said).toBeUndefined();
  }, 180_000);

  afterAll(async () => {
    await scenes.forget("linked");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("turns a part at a ratio of another's turn, on past a whole turn", async () => {
    const followed = await call("blender_animate", {
      follow: [
        {
          object: "Pulley",
          value: "turn",
          axis: "x",
          from: { object: "Crank", value: "turn", axis: "x" },
          ratio: 3,
        },
      ],
    });
    const said = await sampled(["Crank", "Pulley"], [0.5, 1, 1.5]);

    expect(followed.isError, followed.said).toBeUndefined();
    expect(followed.said).toContain(
      "Pulley: its turn around x follows Crank's turn around x, times 3",
    );
    // The crank at 180°, 360° and 540°; the pulley three times as far.
    for (const [time, crank] of [
      [0.5, 180],
      [1, 360],
      [1.5, 540],
    ] as const) {
      expect(valueAt(said, time, "Crank", "turn")).toBeCloseTo(crank, 1);
      expect(valueAt(said, time, "Pulley", "turn")).toBeCloseTo(crank * 3, 1);
    }
  }, 180_000);

  it("clears a part's motion and gives it new motion in one call, and says so plainly", async () => {
    const renewed = await call("blender_animate", {
      clear: ["Pulley"],
      follow: [
        {
          object: "Pulley",
          value: "turn",
          axis: "x",
          from: { object: "Crank", value: "turn", axis: "x" },
          ratio: 2,
        },
      ],
    });
    const said = await sampled(["Pulley"], [0.5]);

    expect(renewed.isError, renewed.said).toBeUndefined();
    expect(renewed.said).toContain(
      "Pulley: its earlier motion is cleared; its turn around x follows Crank's turn around x, times 2.",
    );
    expect(renewed.said).not.toContain("no longer moves");
    expect(valueAt(said, 0.5, "Pulley", "turn")).toBeCloseTo(360, 1);
  }, 180_000);

  it("sets a part's place by a formula of another's turn, and the frame sheet shows it", async () => {
    const followed = await call("blender_animate", {
      follow: [
        {
          object: "Piston",
          value: "place",
          axis: "z",
          from: { object: "Crank", value: "turn", axis: "x" },
          formula: pistonFormula,
        },
      ],
    });
    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 125,
      count: 5,
      tile_width: 160,
      view: "overview",
      objects: ["Piston"],
    });
    const said = await sampled(["Piston"], [0, 0.125, 0.25, 0.375, 0.5]);

    expect(followed.isError, followed.said).toBeUndefined();
    expect(followed.said).toContain(
      "Piston: its place along z follows Crank's turn around x, by " +
        pistonFormula,
    );
    expect(sheet.isError, sheet.said).toBeUndefined();
    // The crank at 0°, 45°, 90°, 135° and 180°, the piston where the formula puts it.
    for (const [i, degrees] of [0, 45, 90, 135, 180].entries())
      expect(valueAt(said, i * 0.125, "Piston", "height")).toBeCloseTo(
        pistonAt(degrees) * 1000,
        0,
      );
    expect(sheet.said).toContain("Piston");
  }, 180_000);

  it("keys a formula too long for Blender to follow live at every frame, and says so", async () => {
    // The piston's formula, with forty-five terms that add nothing: past
    // what Blender works out live, the same heights.
    const long = `${pistonFormula} + 0*(${Array.from({ length: 45 }, () => "sin(v)").join("+")})`;
    expect(long.length).toBeLessThanOrEqual(500);
    await call("blender_add_objects", {
      objects: [
        {
          name: "Long piston",
          kind: "cylinder",
          size: [0.05, 0.05, 0.04],
          location: [0.4, 0, 0.19],
        },
      ],
    });
    const followed = await call("blender_animate", {
      follow: [
        {
          object: "Long piston",
          value: "place",
          axis: "z",
          from: { object: "Crank", value: "turn", axis: "x" },
          formula: long,
        },
      ],
    });
    const said = await sampled(["Long piston"], [0, 0.125, 0.25, 0.375, 0.5]);

    expect(followed.isError, followed.said).toBeUndefined();
    expect(followed.said).toContain(
      "since the formula is too long for Blender to follow live: it follows the motion as it is keyed now",
    );
    expect(followed.said).toMatch(
      /keyed at each of the \d+ frames from 0 s to 2 s/,
    );
    for (const [i, degrees] of [0, 45, 90, 135, 180].entries())
      expect(valueAt(said, i * 0.125, "Long piston", "height")).toBeCloseTo(
        pistonAt(degrees) * 1000,
        0,
      );
  }, 180_000);

  it("keeps a rod between the piston and the crank's pin, attached to one and aimed at the other", async () => {
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Crank pin",
          kind: "cylinder",
          size: [0.01, 0.01, 0.02],
          location: [0, 0, 0.04],
          rotation: [0, 90, 0],
          parent: "Crank",
        },
        {
          name: "Rod",
          kind: "cube",
          size: [0.01, 0.01, 0.01],
          location: [0, 0, 0.19],
          parent: "Piston",
        },
      ],
    });
    const aimed = await call("blender_animate", {
      aim: [{ object: "Rod", at: "Crank pin" }],
    });
    // The rod's length to the pin, and how squarely its front (-y) points
    // at it, at five moments of a turn.
    const said = (
      await call("blender_run_script", {
        code: [
          "import bpy",
          "s = bpy.context.scene",
          "rod, pin = bpy.data.objects['Rod'], bpy.data.objects['Crank pin']",
          "for t in (0, 0.1, 0.25, 0.4, 0.6):",
          "    s.frame_set(s.frame_start + round(t * s.render.fps))",
          "    reach = pin.matrix_world.translation - rod.matrix_world.translation",
          "    front = -rod.matrix_world.col[1].xyz.normalized()",
          "    print('at', t, 'length', round(reach.length * 1000, 2), 'square', round(front.dot(reach.normalized()), 4))",
          "s.frame_set(s.frame_start)",
        ].join("\n"),
      })
    ).said;

    expect(added.isError, added.said).toBeUndefined();
    expect(aimed.isError, aimed.said).toBeUndefined();
    for (const t of [0, 0.1, 0.25, 0.4, 0.6]) {
      const found = new RegExp(`at ${t} length (\\S+) square (\\S+)`).exec(
        said,
      );
      expect(found, said).not.toBeNull();
      // A rod 150 mm long at every moment, pointing straight at the pin.
      expect(Number(found![1])).toBeCloseTo(150, 0);
      expect(Number(found![2])).toBeCloseTo(1, 3);
    }
  }, 180_000);

  it("refuses what cannot be followed, in words, and the scene works on", async () => {
    const pulleyTurn = { object: "Crank", value: "turn", axis: "x" };
    const python = await call("blender_animate", {
      follow: [
        {
          object: "Pulley",
          value: "place",
          axis: "y",
          from: pulleyTurn,
          formula: "__import__('os').getcwd()",
        },
      ],
    });
    const power = await call("blender_animate", {
      follow: [
        {
          object: "Pulley",
          value: "place",
          axis: "y",
          from: pulleyTurn,
          formula: "v**2",
        },
      ],
    });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Lever",
          kind: "cube",
          size: [0.02, 0.02, 0.1],
          location: [-0.2, 0, 0],
        },
      ],
    });
    const keyed = await call("blender_animate", {
      follow: [
        {
          object: "Crank",
          value: "turn",
          axis: "x",
          from: { object: "Lever", value: "place", axis: "y" },
        },
      ],
    });
    const loop = await call("blender_animate", {
      follow: [
        {
          object: "Crank",
          value: "place",
          axis: "y",
          from: { object: "Pulley", value: "turn", axis: "x" },
        },
      ],
    });
    const itself = await call("blender_animate", {
      follow: [
        {
          object: "Pulley",
          value: "place",
          axis: "x",
          from: { object: "Pulley", value: "turn", axis: "x" },
        },
      ],
    });
    const keyOnFollowed = await call("blender_animate", {
      keys: [{ object: "Pulley", at: 1, rotation: [0, 0, 0] }],
    });
    const still = await call("blender_describe_scene", {});

    expect(python.isError).toBe(true);
    expect(python.said).toContain(
      "A formula uses numbers, v, + - * / and brackets, pi, and sin, cos, tan, asin, acos, atan, atan2, sqrt, pow, abs, min, max, floor, fmod, radians and degrees",
    );
    expect(power.isError).toBe(true);
    expect(power.said).toContain("write a power as pow(a, b)");
    expect(keyed.isError).toBe(true);
    expect(keyed.said).toContain(
      "Crank's turn around x is keyed; clear its keys first, since following sets it at every moment.",
    );
    expect(loop.isError).toBe(true);
    expect(loop.said).toContain(
      "Crank cannot follow Pulley, which already moves with Crank.",
    );
    expect(itself.isError).toBe(true);
    expect(itself.said).toContain(
      "Pulley cannot follow itself; its values follow another part's.",
    );
    expect(keyOnFollowed.isError).toBe(true);
    expect(keyOnFollowed.said).toContain(
      "Pulley's turn around x follows Crank; clear Pulley first to key its turn.",
    );
    expect(still.isError).toBeUndefined();
    expect(still.said).toContain(
      "Pulley: turn around x follows Crank's turn around x.",
    );
  }, 180_000);

  it("stops a part following when it is cleared, where it stands", async () => {
    await call("blender_run_script", {
      code: "import bpy\ns = bpy.context.scene\ns.frame_set(s.frame_start + round(0.25 * s.render.fps))",
    });
    const cleared = await call("blender_animate", { clear: ["Pulley"] });
    const said = await sampled(["Pulley"], [0, 1]);

    expect(cleared.isError, cleared.said).toBeUndefined();
    expect(cleared.said).toContain("follows nothing");
    expect(valueAt(said, 0, "Pulley", "turn")).toBeCloseTo(
      valueAt(said, 1, "Pulley", "turn"),
      3,
    );
  }, 180_000);

  it("frames a sheet on the parts named, and opens with how deep they go into each other, measured on their surfaces", async () => {
    // An arm of its own turning as the crank does, and a stop 40 to 80 mm
    // above its axis: the arm's 50 mm reach goes 10 mm into it whenever the
    // arm stands up, at a quarter and three quarters of a turn.
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Arm",
          kind: "cube",
          size: [0.02, 0.1, 0.02],
          location: [0.5, 0, 0],
        },
        {
          name: "Stop",
          kind: "cube",
          size: [0.04, 0.04, 0.04],
          location: [0.5, 0, 0.06],
        },
      ],
    });
    const turning = await call("blender_animate", {
      keys: [
        { object: "Arm", at: 0, rotation: [0, 0, 0] },
        { object: "Arm", at: 2, rotation: [720, 0, 0], easing: "linear" },
      ],
    });
    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 250,
      count: 4,
      tile_width: 160,
      view: "objects",
      objects: ["Arm", "Stop"],
    });
    await call("blender_edit_objects", {
      edits: [
        { object: "Stop", delete: true },
        { object: "Arm", delete: true },
      ],
    });

    expect(added.isError, added.said).toBeUndefined();
    expect(turning.isError, turning.said).toBeUndefined();
    expect(sheet.isError, sheet.said).toBeUndefined();
    expect(sheet.said).toContain("framed on Arm and Stop");
    expect(sheet.said).toContain(
      "Deepest overlaps, measured on the parts' surfaces, not their boxes, at every frame checked:",
    );
    // Every frame from the first drawn to the last is checked, so the arm is
    // found in the stop between the frames drawn too, and deepest there.
    expect(sheet.said).toMatch(
      /Arm and Stop, 10(\.\d+)? mm deep at [^;]+; in each other from 0\.167 s to 0\.333 s and from 0\.667 s to 0\.75 s[.;]/,
    );
    expect(sheet.said).toContain(
      "with what it goes into, measured on their surfaces",
    );
  }, 180_000);

  it("says where an attached part's following place counts from, and it is where the part goes", async () => {
    // A carrier turned and raised, and a rider attached to it whose height
    // follows the crank's turn: its place counts in the carrier's terms.
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Carrier",
          kind: "cube",
          size: [0.05, 0.05, 0.05],
          location: [1, 0, 0.5],
        },
        {
          name: "Rider",
          kind: "cube",
          size: [0.01, 0.01, 0.01],
          location: [1, 0, 0.6],
          parent: "Carrier",
        },
      ],
    });
    const followed = await call("blender_animate", {
      follow: [
        {
          object: "Rider",
          value: "place",
          axis: "z",
          from: { object: "Crank", value: "turn", axis: "x" },
          ratio: 0.0001,
          offset: 0.25,
        },
      ],
    });
    const where = (
      await call("blender_run_script", {
        code: [
          "import bpy",
          "s = bpy.context.scene",
          "s.frame_set(s.frame_start)",
          "print('rider at', round(bpy.data.objects['Rider'].matrix_world.translation.z * 1000, 3))",
        ].join("\n"),
      })
    ).said;
    await call("blender_edit_objects", {
      edits: [
        { object: "Rider", delete: true },
        { object: "Carrier", delete: true },
      ],
    });

    expect(added.isError, added.said).toBeUndefined();
    expect(followed.isError, followed.said).toBeUndefined();
    const zero =
      /in Carrier's terms, where place \(0, 0, 0\) is at \(([^)]*)\) in the world/.exec(
        followed.said,
      );
    expect(zero, followed.said).not.toBeNull();
    // With the crank at 0°, the rider's place is the offset: 250 mm above
    // the point said, in the world.
    const said = zero![1]!
      .split(", ")
      .map((one) =>
        one.endsWith(" mm")
          ? Number(one.slice(0, -3))
          : Number(one.slice(0, -2)) * 1000,
      );
    expect(Number(/rider at (-?[\d.]+)/.exec(where)?.[1])).toBeCloseTo(
      said[2]! + 250,
      0,
    );
  }, 180_000);

  it("frames named parts from the side the rest of the scene covers least, and checks every moving part for clashes", async () => {
    // A part walled in on its front, right and top, open to the back and
    // left; and, apart, a row of spinning parts, the last of which turns into
    // a stop.
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Gear",
          kind: "cube",
          size: [0.04, 0.04, 0.04],
          location: [3, 0, 0.02],
        },
        {
          name: "Front wall",
          kind: "cube",
          size: [0.2, 0.01, 0.2],
          location: [3, -0.06, 0.1],
        },
        {
          name: "Right wall",
          kind: "cube",
          size: [0.01, 0.2, 0.2],
          location: [3.06, 0, 0.1],
        },
        {
          name: "Roof",
          kind: "cube",
          size: [0.2, 0.2, 0.01],
          location: [3, 0, 0.2],
        },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          name: `Spinner ${n}`,
          kind: "cube",
          size: [0.02, 0.02, 0.02],
          location: [-3 - n * 0.2, 0, 0],
        })),
        {
          name: "Zz arm",
          kind: "cube",
          size: [0.02, 0.1, 0.02],
          location: [-6, 0, 0],
        },
        {
          name: "Zz stop",
          kind: "cube",
          size: [0.04, 0.04, 0.04],
          location: [-6, 0, 0.06],
        },
      ],
    });
    const turning = await call("blender_animate", {
      keys: [1, 2, 3, 4, 5, 6, 7, 8]
        .map((n) => `Spinner ${n}`)
        .concat("Zz arm")
        .flatMap((object) => [
          { object, at: 0, rotation: [0, 0, 0] },
          { object, at: 2, rotation: [720, 0, 0], easing: "linear" },
        ]),
    });
    const walled = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 500,
      count: 2,
      tile_width: 160,
      view: "objects",
      objects: ["Gear"],
    });
    const overview = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 250,
      count: 4,
      tile_width: 160,
      view: "overview",
    });
    await call("blender_edit_objects", {
      edits: [
        "Gear",
        "Front wall",
        "Right wall",
        "Roof",
        "Zz arm",
        "Zz stop",
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Spinner ${n}`),
      ].map((object) => ({ object, delete: true })),
    });

    expect(added.isError, added.said).toBeUndefined();
    expect(turning.isError, turning.said).toBeUndefined();
    expect(walled.isError, walled.said).toBeUndefined();
    expect(walled.said).toMatch(
      /framed on Gear, from the (back|back-left|left), [\d.]+° above level, the side the rest of the scene covers least of them,/,
    );
    expect(walled.said).not.toContain("covered by other parts");
    expect(overview.isError, overview.said).toBeUndefined();
    // Past the first eight moving parts, the arm's clash is still found.
    expect(overview.said).toMatch(/Zz arm and Zz stop, 10(\.\d+)? mm deep/);
    expect(overview.said).toMatch(
      /\(and \d+ more moving objects: name them in objects to see where they are\)/,
    );
  }, 300_000);

  it("finds two moving parts that go into each other when only another part is named", async () => {
    // Two blocks 50 mm into each other sliding together, and a marker apart.
    const added = await call("blender_add_objects", {
      objects: [
        {
          name: "Lefthalf",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [3, 0, 0],
        },
        {
          name: "Righthalf",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [3.05, 0, 0],
        },
        {
          name: "Marker",
          kind: "cube",
          size: [0.05, 0.05, 0.05],
          location: [3, 1, 0],
        },
      ],
    });
    const sliding = await call("blender_animate", {
      keys: ["Lefthalf", "Righthalf", "Marker"].flatMap((object, i) => [
        { object, at: 0, location: [3 + [0, 0.05, 0][i]!, [0, 0, 1][i]!, 0] },
        {
          object,
          at: 1,
          location: [3 + [0, 0.05, 0][i]!, [0, 0, 1][i]! + 0.5, 0],
          easing: "linear",
        },
      ]),
    });
    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 500,
      count: 2,
      tile_width: 160,
      engine: "solid",
      view: "objects",
      objects: ["Marker"],
    });
    await call("blender_edit_objects", {
      edits: ["Lefthalf", "Righthalf", "Marker"].map((object) => ({
        object,
        delete: true,
      })),
    });

    expect(added.isError, added.said).toBeUndefined();
    expect(sliding.isError, sliding.said).toBeUndefined();
    expect(sheet.isError, sheet.said).toBeUndefined();
    expect(sheet.said).toMatch(/Lefthalf and Righthalf, 50(\.\d+)? mm deep/);
    expect(sheet.said).not.toContain("were not checked");
  }, 300_000);

  it("says how many moving parts a frame sheet did not check for overlaps, past the most it checks", async () => {
    // Sixty-two small cubes, far from everything, each sliding along x.
    const made = await call("blender_run_script", {
      code: [
        "import bpy",
        "s = bpy.context.scene",
        "for i in range(62):",
        "    mesh = bpy.data.meshes.new(f'Swarm {i}')",
        "    h = 0.005",
        "    mesh.from_pydata([(x, y, z) for x in (-h, h) for y in (-h, h) for z in (-h, h)], [], [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])",
        "    obj = bpy.data.objects.new(f'Swarm {i}', mesh)",
        "    s.collection.objects.link(obj)",
        "    obj.location = (10 + i * 0.05, 10, 0)",
        "    obj.keyframe_insert('location', index=0, frame=s.frame_start)",
        "    obj.location.x += 0.01",
        "    obj.keyframe_insert('location', index=0, frame=s.frame_start + 12)",
        "print('made', len([o for o in s.objects if o.name.startswith('Swarm')]))",
      ].join("\n"),
    });
    const sheet = await call("blender_frame_sheet", {
      time: 0,
      every_ms: 500,
      count: 2,
      tile_width: 160,
      engine: "solid",
      view: "overview",
    });
    await call("blender_edit_objects", {
      edits: [{ object: "/Swarm \\d+/", delete: true }],
    });

    expect(made.said).toContain("made 62");
    expect(sheet.isError, sheet.said).toBeUndefined();
    const unchecked = Number(
      /Only 60 parts were checked for overlaps; (\d+) more moving parts? (was|were) not: name those to check in objects\./.exec(
        sheet.said,
      )?.[1],
    );
    // At least the swarm's two past the sixty, and every other moving part too.
    expect(unchecked).toBeGreaterThanOrEqual(2);
  }, 600_000);
});
