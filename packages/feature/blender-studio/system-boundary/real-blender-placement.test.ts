/**
 * Placing objects against a real Blender: turning one round a hinge, setting
 * one down on several supports, on what is below, on a floor object or
 * tilted to a slope, copying round an axis with one shared mesh, setting
 * objects out along a line, a circle or a curve, and dropping them with
 * physics onto what they rest on. Each answer says where things landed and
 * what they rest on.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
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
  content: { type: string; text?: string }[];
};

const cube = (
  name: string,
  size: number[],
  location: number[],
  rotation?: number[],
) => ({
  name,
  kind: "cube",
  size,
  location,
  ...(rotation ? { rotation } : {}),
});

describe.runIf(blender)("placing objects in a real Blender", () => {
  const folders = new TemporaryFolders();
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      failed: result.isError === true,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  const fresh = async (objects: Record<string, unknown>[]) => {
    await call("blender_run_script", {
      code: "import bpy\nfor o in list(bpy.data.objects): bpy.data.objects.remove(o)",
    });
    const added = await call("blender_add_objects", { objects });
    expect(added.failed, added.said).toBe(false);
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-placement-");
    const workspace = join(root, "workspace");
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
    tools = sceneAutomation(scenes.scene("placement"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("placement"),
    });
    await call("blender_open_scene", { path: "placement.blend", create: true });
  });

  afterAll(async () => {
    await scenes.forget("placement");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("turns a door round its hinge, a point or an object, and says where it went", async () => {
    await fresh([
      cube("Door", [0.8, 0.04, 2], [0.4, 0, 1]),
      cube("Hinge", [0.02, 0.02, 0.1], [0, 0, 1]),
    ]);

    const opened = await call("blender_edit_objects", {
      edits: [
        {
          object: "Door",
          turn_about: { point: [0, 0, 0], axis: "z", angle: 90 },
        },
      ],
    });
    const shut = await call("blender_edit_objects", {
      edits: [
        {
          object: "Door",
          turn_about: { object: "Hinge", axis: "z", angle: -90 },
        },
      ],
    });

    expect(opened.failed, opened.said).toBe(false);
    expect(opened.said).toContain(
      "Door: turned 90° round z through (0, 0, 0 mm), moved from (0.4, 0, 1 m); now Door (0.8 × 0.04 × 2 m) at (0, 0.4, 1 m), turned (0°, 0°, 90°)",
    );
    expect(shut.said).toContain(
      "Door: turned -90° round z through Hinge's origin at (0, 0, 1 m), moved from (0, 0.4, 1 m); now Door (0.8 × 0.04 × 2 m) at (0.4, 0, 1 m)",
    );
  });

  it("sets a plank down across two trestles, and a box on whatever is below it", async () => {
    await fresh([
      cube("Trestle A", [0.1, 0.4, 0.5], [-0.5, 0, 0.25]),
      cube("Trestle B", [0.1, 0.4, 0.5], [0.5, 0, 0.25]),
      cube("Plank", [1.4, 0.3, 0.03], [0, 0, 1]),
      cube("Box", [0.2, 0.2, 0.2], [0, 0, 2]),
    ]);

    const plank = await call("blender_edit_objects", {
      edits: [{ object: "Plank", rest_across: ["Trestle A", "Trestle B"] }],
    });
    const box = await call("blender_edit_objects", {
      edits: [{ object: "Box", rest_on: "below" }],
    });

    expect(plank.failed, plank.said).toBe(false);
    expect(plank.said).toContain(
      "resting on Trestle A and Trestle B, gap 0 mm to each",
    );
    expect(plank.said).toContain("from 500 mm to 530 mm high");
    expect(box.said).toContain("resting on Plank, gap 0 mm");
    expect(box.said).toContain("from 530 mm to 730 mm high");
  });

  it("sets a crate on the floor object when there is one, and refuses supports it is not over", async () => {
    await fresh([
      cube("Floor", [4, 4, 0.1], [0, 0, 0.05]),
      cube("Crate", [0.3, 0.3, 0.3], [0, 0, 2]),
      cube("Shelf", [0.5, 0.3, 0.02], [3, 3, 1]),
    ]);

    const crate = await call("blender_edit_objects", {
      edits: [{ object: "Crate", rest_on: "floor" }],
    });
    const away = await call("blender_edit_objects", {
      edits: [{ object: "Crate", rest_on: "Shelf" }],
    });

    expect(crate.said).toContain("resting on Floor");
    expect(crate.said).toContain("from 100 mm to 400 mm high");
    expect(away.failed).toBe(true);
    expect(away.said).toContain(
      "“Crate” is not above “Shelf”. Give it a location over it first.",
    );
  });

  it("tilts a rock to follow the slope it lands on", async () => {
    await fresh([
      cube("Ramp", [2, 1, 0.1], [0, 0, 0.5], [0, 15, 0]),
      cube("Rock", [0.2, 0.2, 0.2], [0, 0, 2]),
    ]);

    const rock = await call("blender_edit_objects", {
      edits: [{ object: "Rock", rest_on: "Ramp", align_to_surface: true }],
    });

    expect(rock.failed, rock.said).toBe(false);
    expect(rock.said).toContain("resting on Ramp, tilted 15° to follow Ramp");
    expect(rock.said).toContain("turned (0°, 15°, 0°)");
  });

  it("copies a chair round a table sharing one mesh, and a resize gives a copy its own", async () => {
    await fresh([cube("Chair", [0.4, 0.4, 0.8], [1, 0, 0.4])]);

    const round = await call("blender_edit_objects", {
      edits: [
        {
          object: "Chair",
          duplicate: {
            count: 3,
            linked: true,
            around: { point: [0, 0, 0], axis: "z" },
          },
        },
      ],
    });
    const resized = await call("blender_edit_objects", {
      edits: [{ object: "Chair 2", size: [0.5, 0.5, 0.8] }],
    });

    expect(round.failed, round.said).toBe(false);
    expect(round.said).toContain(
      "copied turned round z through (0, 0, 0 mm), 90° apart, as Chair 2 at (0, 1, 0.4 m)",
    );
    expect(round.said).toContain("Chair 4 at (0, -1, 0.4 m)");
    expect(round.said).toContain(
      "sharing one mesh of 6 faces among 4 objects: 6 faces held in memory, 24 drawn",
    );
    expect(resized.said).toContain(
      "its mesh its own now, no longer shared with 3 others",
    );
  });

  it("pushes a bookcase against a wall and a crate against a round post, saying the gap after", async () => {
    await fresh([
      cube("Wall", [4, 0.2, 2.5], [0, 1, 1.25]),
      cube("Bookcase", [0.8, 0.3, 1.8], [0.5, -1, 0.9]),
      {
        name: "Post",
        kind: "cylinder",
        size: [0.3, 0.3, 1],
        location: [2, -2, 0.5],
      },
      cube("Crate", [0.4, 0.4, 0.4], [0, -2, 0.2]),
      cube("Lamp", [0.2, 0.2, 0.2], [5, 5, 0.1]),
    ]);

    const pushed = await call("blender_edit_objects", {
      edits: [
        { object: "Bookcase", against: { object: "Wall", side: "front" } },
        {
          object: "Crate",
          against: { object: "Post", side: "left", gap: 0.01 },
        },
      ],
    });
    const past = await call("blender_edit_objects", {
      edits: [{ object: "Lamp", against: { object: "Wall", side: "front" } }],
    });

    expect(pushed.failed, pushed.said).toBe(false);
    // The wall's front face is at y 0.9; the bookcase is 0.3 m deep.
    expect(pushed.said).toContain(
      "Bookcase: pushed against Wall's front side (-y), gap 0 mm, moved from (0.5, -1, 0.9 m); now Bookcase (0.8 × 0.3 × 1.8 m) at (500, 750, 900 mm)",
    );
    expect(pushed.said).toContain(
      "Where what moved stands: Bookcase rests on the floor, against Wall; Crate rests on the floor.",
    );
    // The post's left is at x 1.85: the crate's right ends 10 mm short of it.
    expect(pushed.said).toMatch(
      /Crate: pushed against Post's left side \(-x\), gap 10(\.0\d*)? mm, moved from \(0, -2, 0\.2 m\); now Crate \(400 × 400 × 400 mm\) at \(1\.64\d*, -2, 0\.2 m\)/,
    );
    expect(past.failed).toBe(true);
    expect(past.said).toContain(
      "“Lamp” is not across from “Wall” along y, so pushed along it it would pass it",
    );
  });

  it("lays a vase's bottom on a table's top and a frame's back on a wall, saying where and the gap", async () => {
    await fresh([
      cube("Table", [1.2, 0.8, 0.75], [0, 0, 0.375]),
      cube("Vase", [0.1, 0.1, 0.3], [3, 3, 3]),
      cube("Wall", [4, 0.2, 2.5], [0, 2, 1.25]),
      cube("Frame", [0.5, 0.03, 0.4], [1, 0, 1.6]),
      cube("Peg", [0.02, 0.02, 0.02], [0.7, 0.5, 1]),
    ]);

    const laid = await call("blender_edit_objects", {
      edits: [
        { object: "Vase", to: { object: "Table", point: "top-centre" } },
        {
          object: "Frame",
          to: { object: "Wall", point: "nearest-surface", by: "back-centre" },
        },
        { object: "Peg", to: { object: "Table", point: "nearest-vertex" } },
      ],
    });
    const both = await call("blender_edit_objects", {
      edits: [
        {
          object: "Vase",
          rest_on: "Table",
          to: { object: "Table", point: "top-centre" },
        },
      ],
    });

    expect(laid.failed, laid.said).toBe(false);
    expect(laid.said).toContain(
      "Vase: moved so its bottom-centre is on Table's top-centre at (0, 0, 750 mm), on its side facing +z, gap 0 mm",
    );
    expect(laid.said).toContain("from 750 mm to 1.05 m high");
    // The wall's front face is at y 1.9; the frame's back goes onto it.
    expect(laid.said).toContain(
      "Frame: moved so its back-centre is on Wall's nearest-surface at (1, 1.9, 1.6 m), on its side facing -y, gap 0 mm",
    );
    expect(laid.said).toContain(
      "Peg: moved so its bottom-centre is on Table's nearest-vertex at (600, 400, 750 mm), gap 0 mm",
    );
    expect(laid.said).toContain(
      "Frame stands against Wall, nothing under it; Peg rests on Table; Vase rests on Table.",
    );
    expect(both.failed).toBe(true);
    expect(both.said).toContain(
      "“Vase” is set down by rest_on or moved onto a point by to: give one of them.",
    );
  });

  it("places a collection and an object as instances, measured and checked as shapes", async () => {
    await fresh([
      cube("Floor", [4, 4, 0.1], [0, 0, -0.05]),
      cube("Crate", [0.4, 0.4, 0.4], [3, 3, 0.2]),
    ]);
    await call("blender_run_script", {
      code: [
        "kit = bpy.data.collections.new('Kit')",
        "bpy.context.scene.collection.children.link(kit)",
        "for i in range(2):",
        "    bpy.ops.mesh.primitive_cube_add(size=0.2, location=(i * 0.3, 0, 0.1))",
        "    o = bpy.context.object",
        "    o.name = f'Box {i}'",
        "    for c in list(o.users_collection): c.objects.unlink(o)",
        "    kit.objects.link(o)",
        "kit.hide_render = True",
      ].join("\n"),
    });

    const added = await call("blender_add_objects", {
      objects: [
        { name: "Kit here", kind: "instance", of: "Kit", location: [-1, 0, 2] },
        {
          name: "Crate copy",
          kind: "instance",
          of: "Crate",
          location: [1, 0, 0.2],
        },
      ],
    });
    const rested = await call("blender_edit_objects", {
      edits: [{ object: "Kit here", rest_on: "Floor" }],
    });
    const smoothed = await call("blender_add_objects", {
      objects: [
        { name: "Crate 3", kind: "instance", of: "Crate", smooth: true },
      ],
    });

    expect(added.failed, added.said).toBe(false);
    expect(added.said).toContain(
      "places 2 instances: 1 of Box 0, 6 faces each; 1 of Box 1, 6 faces each, their box from (-1.1, -0.1, 2 m) to (-0.6, 0.1, 2.2 m)",
    );
    expect(added.said).toContain(
      "places 1 instance of Crate, 6 faces each, their box from (800, -200, 0 mm) to (1.2, 0.2, 0.4 m)",
    );
    // The empty placing the kit is checked as a shape: it floats until set down.
    expect(added.said).toContain(
      "Kit here: held by nothing: its 2 pieces touch no other shape and its bottom is 2 m above the floor",
    );
    expect(added.said).toContain(
      "Where what moved stands: Kit here touches nothing, 2 m above Floor; Crate copy rests on Floor.",
    );
    expect(rested.said).toContain("resting on Floor, gap 0 mm");
    expect(rested.said).toContain("Kit here rests on Floor");
    expect(smoothed.failed).toBe(true);
    expect(smoothed.said).toContain(
      "“Crate 3” is an instance, which shows its source's shape as it is: smooth or bevel the source instead.",
    );
  });

  it("marks a kite as flying, so it is said aloft and never said to float", async () => {
    await fresh([
      cube("Ground", [4, 4, 0.1], [0, 0, -0.05]),
      cube("Kite", [0.5, 0.1, 0.5], [0, 0, 3]),
      cube("Balloon", [0.2, 0.2, 0.2], [10, 10, 2]),
    ]);

    const marked = await call("blender_edit_objects", {
      edits: [{ object: "Kite", flying: true }],
    });
    const moved = await call("blender_edit_objects", {
      edits: [
        { object: "Kite", move_by: [0, 0, 1] },
        { object: "Balloon", move_by: [0, 0, 0.1] },
      ],
    });

    expect(marked.said).toContain("marked as flying, so never said to float");
    expect(moved.said).not.toContain("- Kite: held by nothing");
    expect(moved.said).toContain(
      "Where what moved stands: Kite is flying, 3.75 m above Ground; Balloon touches nothing, 2 m above the floor, nothing under it.",
    );
  });

  it("refuses a copy with neither a step nor a turn to place it by", async () => {
    await fresh([cube("Chair", [0.4, 0.4, 0.8], [1, 0, 0.4])]);

    const { failed, said } = await call("blender_edit_objects", {
      edits: [{ object: "Chair", duplicate: { count: 2 } }],
    });

    expect(failed).toBe(true);
    expect(said).toContain(
      "Give exactly one of edits[0].duplicate.offset and edits[0].duplicate.around.",
    );
  });

  it("sets posts out along a line, evenly or with even gaps", async () => {
    await fresh([cube("Post", [0.1, 0.1, 1], [0, 0, 0.5])]);

    const even = await call("blender_edit_objects", {
      edits: [
        {
          object: "Post",
          distribute: {
            count: 5,
            along: {
              line: [
                [0, 0, 0.5],
                [4, 0, 0.5],
              ],
            },
          },
        },
      ],
    });
    const gapped = await call("blender_edit_objects", {
      edits: [
        {
          object: "Post",
          distribute: {
            with: ["Post 2", "Post 3", "Post 4", "Post 5"],
            spacing: "gaps",
            along: {
              line: [
                [0, 0, 0.5],
                [4, 0, 0.5],
              ],
            },
          },
        },
      ],
    });

    expect(even.failed, even.said).toBe(false);
    expect(even.said).toContain(
      "set out 5 along the line from (0, 0, 500 mm) to (4, 0, 0.5 m): Post, Post 2, Post 3, Post 4, Post 5; 1 m apart along it, gaps 900 mm",
    );
    expect(gapped.said).toContain("975 mm apart along it, gaps 875 mm");
  });

  it("sets seats round a circle facing its middle, and boxes along a curve", async () => {
    await fresh([cube("Seat", [0.4, 0.4, 0.4], [0, 0, 0.2])]);

    const seats = await call("blender_edit_objects", {
      edits: [
        {
          object: "Seat",
          distribute: {
            count: 4,
            along: { circle: { centre: [0, 0, 0.2], radius: 1 } },
            face: "centre",
          },
        },
      ],
    });
    await call("blender_run_script", {
      code: "zhiyin.curve('Path', [[0, 2, 0], [2, 2, 0], [4, 2, 0]], kind='poly')",
    });
    await call("blender_add_objects", {
      objects: [cube("Box", [0.2, 0.2, 0.2], [0, 0, 0])],
    });
    const boxes = await call("blender_edit_objects", {
      edits: [
        {
          object: "Box",
          distribute: { count: 3, along: { curve: "Path" }, face: "along" },
        },
      ],
    });

    expect(seats.failed, seats.said).toBe(false);
    expect(seats.said).toContain(
      "set out 4 along a circle 2 m across round (0, 0, 200 mm) about z: Seat, Seat 2, Seat 3, Seat 4; 1.571 m apart along it",
    );
    expect(seats.said).toMatch(
      /Seat: .*at \(1, 0, 0\.2 m\), turned \(0°, 0°, -90°\)/,
    );
    expect(boxes.said).toContain(
      "set out 3 along the curve Path, 4 m long: Box, Box 2, Box 3; 2 m apart along it",
    );
  });

  it("drops a tilted box onto the ground with physics and keeps where it settled", async () => {
    await fresh([
      cube("Ground", [2, 2, 0.2], [0, 0, -0.1]),
      cube("Box", [0.2, 0.2, 0.2], [0.3, 0, 0.4], [20, 10, 0]),
    ]);

    const { failed, said } = await call("blender_settle_objects", {
      objects: ["Box"],
      on: ["Ground"],
      seconds: 3,
    });
    const after = await call("blender_run_script", {
      code: "print(bpy.context.scene.rigidbody_world, bpy.data.objects['Box'].rigid_body)",
    });

    expect(failed, said).toBe(false);
    expect(said).toMatch(
      /Box: fell [\d.]+ mm, slid [\d.]+ mm and turned [\d.]+°, rests on Ground; now Box .*from 0\.5\d* mm to 200\.5\d* mm high/,
    );
    expect(said).toContain(
      "Shapes rest 0.5 mm apart, the margin the physics keeps between them.",
    );
    expect(after.said).toContain("None None");
  });
});
