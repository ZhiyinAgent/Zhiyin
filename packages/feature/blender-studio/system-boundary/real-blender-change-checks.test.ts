/**
 * The checks after a change against a real Blender: each fault in a scene
 * that has it and not in one without it — the faces and points of a shape,
 * how a shape stands, the values and pictures of a material, how a shape
 * lies in its picture — and the shaping, resizing, copying and aiming
 * answers said from what was measured after the change.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio/system-boundary/real-blender-change-checks.test.ts
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

const CLEAN = "Checked what this call changed: no faults.";

/** Python that adds a mesh object built by bmesh, for a script to use. */
const meshMaker = [
  "import bmesh, bpy, math, mathutils",
  "s = bpy.context.scene",
  "def made(name, build, at=(0, 0, 0)):",
  "    shape = bmesh.new()",
  "    build(shape)",
  "    mesh = bpy.data.meshes.new(name)",
  "    shape.to_mesh(mesh)",
  "    shape.free()",
  "    obj = bpy.data.objects.new(name, mesh)",
  "    obj.location = at",
  "    s.collection.objects.link(obj)",
  "    return obj",
  "def cube(b):",
  "    bmesh.ops.create_cube(b, size=0.1)",
];

describe.runIf(blender)("a real Blender's checks after a change", () => {
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
  const done = async (name: string, args: Record<string, unknown>) => {
    const answer = await call(name, args);
    expect(answer.isError, answer.said).toBeUndefined();
    return answer.said;
  };
  const script = (lines: string[]) =>
    done("blender_run_script", { code: lines.join("\n") });
  /** The faults said of one object or material, from a change's answer. */
  const faultsOf = (said: string, name: string) =>
    said.split("\n").find((l) => l.startsWith(`- ${name}: `)) ?? "";

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-change-checks-");
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
    tools = sceneAutomation(scenes.scene("checks"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("checks"),
    });
  });

  afterAll(async () => {
    await scenes.forget("checks");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("finds no fault in any shape the tools make", async () => {
    await done("blender_open_scene", { path: "kinds.blend", create: true });
    const added = await done("blender_add_objects", {
      objects: [
        {
          name: "Box",
          kind: "box",
          size: [0.2, 0.1, 0.05],
          location: [0, 0, 0.025],
        },
        {
          name: "Can",
          kind: "cylinder",
          size: [0.1, 0.1, 0.2],
          location: [0.3, 0, 0.1],
        },
        {
          name: "Spike",
          kind: "cone",
          size: [0.1, 0.1, 0.2],
          location: [0.6, 0, 0.1],
        },
        {
          name: "Ball",
          kind: "sphere",
          size: [0.1, 0.1, 0.1],
          location: [0.9, 0, 0.05],
        },
        { name: "Mat", kind: "plane", size: [0.3, 0.3], location: [0, 0.5, 0] },
        {
          name: "Ring",
          kind: "torus",
          diameter: 0.1,
          thickness: 0.02,
          location: [0.3, 0.5, 0.01],
        },
        {
          name: "Vase",
          kind: "revolve",
          profile: [
            [0, 0],
            [0.04, 0],
            [0.05, 0.1],
            [0.03, 0.2],
            [0, 0.2],
          ],
          location: [0.6, 0.5, 0],
        },
        {
          name: "Washer",
          kind: "revolve",
          profile: [
            [0.02, 0],
            [0.04, 0],
            [0.04, 0.003],
            [0.02, 0.003],
          ],
          location: [0.9, 0.5, 0],
        },
        {
          name: "Plate",
          kind: "outline",
          points: [
            [0, 0],
            [0.1, 0],
            [0.12, 0.05],
            [0.05, 0.1],
            [-0.02, 0.05],
          ],
          holes: [
            [
              [0.03, 0.03],
              [0.06, 0.03],
              [0.05, 0.06],
            ],
          ],
          height: 0.01,
          location: [0, 1, 0],
        },
        {
          name: "Hose",
          kind: "tube",
          points: [
            [0.3, 1, 0.01],
            [0.4, 1.05, 0.01],
            [0.5, 1.1, 0.01],
          ],
          radius: 0.01,
        },
        {
          name: "Word",
          kind: "text",
          text: "Zhiyin 8&@",
          height: 0.05,
          depth: 0.01,
          location: [0.8, 1, 0.005],
        },
      ],
    });
    expect(added).toContain(CLEAN);
  }, 120_000);

  it("names the faults in a shape's faces and points, each with where, and none in a sound one", async () => {
    await done("blender_open_scene", { path: "faces.blend", create: true });
    const sound = await script([
      ...meshMaker,
      "made('Sound', cube, (0, 0, 0.05))",
    ]);
    expect(sound).toContain(CLEAN);
    const faulty = await script([
      ...meshMaker,
      "def seamed(b):",
      "    bmesh.ops.create_uvsphere(b, u_segments=16, v_segments=8, radius=0.05)",
      "    bmesh.ops.split_edges(b, edges=[e for e in b.edges if all(abs(v.co.x) < 1e-6 and v.co.y > 0 for v in e.verts)])",
      "def flipped(b):",
      "    cube(b)",
      "    b.faces.ensure_lookup_table()",
      "    bmesh.ops.reverse_faces(b, faces=[b.faces[0], b.faces[1]])",
      "def doubled(b):",
      "    cube(b)",
      "    b.faces.ensure_lookup_table()",
      "    b.faces.new([b.verts.new(v.co) for v in b.faces[0].verts])",
      "def finned(b):",
      "    cube(b)",
      "    b.edges.ensure_lookup_table()",
      "    a, c = b.edges[0].verts",
      "    up = mathutils.Vector((0, 0.1, 0.1))",
      "    b.faces.new([a, c, b.verts.new(c.co + up), b.verts.new(a.co + up)])",
      "def strays(b):",
      "    cube(b)",
      "    b.verts.new((0.3, 0, 0))",
      "def warped(b):",
      "    b.faces.new([b.verts.new((0.1 * math.cos(i * math.pi / 3), 0.1 * math.sin(i * math.pi / 3), 0.03 * (i % 2))) for i in range(6)])",
      "def collapsed(b):",
      "    cube(b)",
      "    a = b.verts.new((0.2, 0, 0))",
      "    b.faces.new([a, b.verts.new((0.25, 0, 0)), b.verts.new((0.3, 0, 0))])",
      "made('Seamed', seamed, (1, 0, 0.05))",
      "made('Flipped', flipped, (2, 0, 0.05))",
      "made('Doubled', doubled, (3, 0, 0.05))",
      "made('Finned', finned, (4, 0, 0.05))",
      "made('Strays', strays, (5, 0, 0.05))",
      "made('Warped', warped, (6, 0, 0))",
      "made('Collapsed', collapsed, (7, 0, 0.05))",
      "def bent(b):",
      "    bmesh.ops.create_grid(b, x_segments=3, y_segments=3, size=0.1)",
      "    b.faces.ensure_lookup_table()",
      "    bmesh.ops.reverse_faces(b, faces=[b.faces[0]])",
      "made('Bent', bent, (8, 0, 0))",
      "made('Sheet', lambda b: bmesh.ops.create_grid(b, x_segments=3, y_segments=3, size=0.1), (9, 0, 0))",
    ]);
    expect(faulty).toContain("Faults in what this call changed:");
    expect(faultsOf(faulty, "Seamed")).toMatch(
      /\d+ points lie on others without being joined to them, so its surface is open along them, as at \(/,
    );
    expect(faultsOf(faulty, "Flipped")).toMatch(
      /2 faces point into its shape, the largest at \(/,
    );
    expect(faultsOf(faulty, "Doubled")).toMatch(
      /2 faces lie on one another with the same corners/,
    );
    expect(faultsOf(faulty, "Finned")).toMatch(
      /1 edge is shared by more than two faces/,
    );
    expect(faultsOf(faulty, "Strays")).toMatch(
      /1 point on no face, as at \(5\.3, 0, 0\.05 m\)/,
    );
    expect(faultsOf(faulty, "Warped")).toMatch(
      /1 face of more than four sides is not flat, a corner up to 15 mm off its plane/,
    );
    expect(faultsOf(faulty, "Collapsed")).toMatch(/1 face has no area/);
    // An open sheet has no inside: a face turned against the rest of it is the fault.
    expect(faultsOf(faulty, "Bent")).toMatch(
      /1 face faces against the rest of its piece, as at \(/,
    );
    expect(faultsOf(faulty, "Sheet")).toBe("");
    expect(faultsOf(faulty, "Sound")).toBe("");
    // A change that touches nothing the checks look at says nothing of them.
    const renamed = await done("blender_edit_objects", {
      edits: [{ object: "Sound", rename: "Whole" }],
    });
    expect(renamed).not.toMatch(/Checked what|Faults in/);
    // A hollow's inner walls face into it, which is out of the solid.
    const hollow = await done("blender_add_objects", {
      objects: [
        {
          name: "Crate",
          kind: "box",
          size: [0.3, 0.3, 0.3],
          location: [0, 2, 0.15],
        },
      ],
    });
    expect(hollow).toContain(CLEAN);
    const thickened = await done("blender_shape_objects", {
      object: "Crate",
      operations: [{ kind: "solidify", thickness: 0.01 }],
    });
    expect(thickened).toContain(CLEAN);
  }, 120_000);

  it("finds no fault in a subdivided cube, whose curved faces all point out", async () => {
    const rounded = await script([
      ...meshMaker,
      "def big(b):",
      "    bmesh.ops.create_cube(b, size=1)",
      "rounded = made('Rounded', big, (0, 4, 0.5))",
      "rounded.modifiers.new('Smooth', 'SUBSURF').levels = 3",
      "rounded.data = bpy.data.meshes.new_from_object(rounded.evaluated_get(bpy.context.evaluated_depsgraph_get()))",
      "rounded.modifiers.clear()",
      "rounded.location.z = -min(v.co.z for v in rounded.data.vertices)",
    ]);

    expect(rounded).toContain(CLEAN);
  }, 120_000);

  it("names a boolean a script added that takes nothing away", async () => {
    await done("blender_open_scene", { path: "cut.blend", create: true });
    await script([
      ...meshMaker,
      "made('Block', cube, (0, 0, 0.05))",
      "made('Far', cube, (1, 0, 0.05)).hide_render = True",
      "made('Near', cube, (0.05, 0, 0.05)).hide_render = True",
    ]);
    const missed = await script([
      "import bpy",
      "cut = bpy.data.objects['Block'].modifiers.new('Hole', 'BOOLEAN')",
      "cut.object = bpy.data.objects['Far']",
    ]);
    expect(faultsOf(missed, "Block")).toContain(
      "its Hole takes nothing away: Far does not pass into it",
    );
    const reached = await script([
      "import bpy",
      "bpy.data.objects['Block'].modifiers['Hole'].object = bpy.data.objects['Near']",
    ]);
    expect(reached).not.toContain("takes nothing away");
  }, 120_000);

  it("says what stands clear of what held it, what tips over and what lies wholly inside another", async () => {
    await done("blender_open_scene", { path: "standing.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Saucer",
          kind: "cylinder",
          size: [0.15, 0.15, 0.01],
          location: [0, 0, 0.005],
        },
      ],
    });
    const rested = await done("blender_add_objects", {
      objects: [
        {
          name: "Mug",
          kind: "cylinder",
          size: [0.08, 0.08, 0.1],
          location: [0, 0, 0.2],
          rest_on: "Saucer",
        },
      ],
    });
    expect(rested).toContain(CLEAN);
    // A well cut under the mug leaves it standing over the well's floor.
    const cut = await done("blender_shape_objects", {
      object: "Saucer",
      operations: [
        {
          kind: "boolean",
          cutter: {
            shape: "cylinder",
            diameter: 0.09,
            depth: 0.004,
            location: [0, 0, 0.01],
          },
        },
      ],
    });
    expect(faultsOf(cut, "Mug")).toContain(
      "held by nothing: it touches no other shape and its bottom is 2 mm above Saucer",
    );

    const tipping = await done("blender_add_objects", {
      objects: [
        {
          name: "Post",
          kind: "box",
          size: [0.05, 0.05, 0.1],
          location: [1, 0, 0.05],
        },
        {
          name: "Plank",
          kind: "box",
          size: [0.4, 0.05, 0.02],
          location: [1.15, 0, 0.11],
        },
        {
          name: "Shelf",
          kind: "box",
          size: [0.4, 0.05, 0.02],
          location: [1, 1, 0.11],
        },
        {
          name: "Leg",
          kind: "box",
          size: [0.05, 0.05, 0.1],
          location: [1, 1, 0.05],
        },
      ],
    });
    expect(faultsOf(tipping, "Plank")).toMatch(
      /would tip over toward \+x: its centre of mass, at \(1\.15, 0, 0\.11 m\), is 125 mm beyond where it stands on Post/,
    );
    expect(faultsOf(tipping, "Shelf")).toBe("");
    // A handle whose ends go into a pot's side is held by them, not standing.
    await done("blender_add_objects", {
      objects: [
        {
          name: "Pot",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [2, 0, 0.05],
        },
      ],
    });
    const gripped = await done("blender_add_objects", {
      objects: [
        {
          name: "Grip",
          kind: "tube",
          radius: 0.005,
          points: [
            [2.04, 0, 0.08],
            [2.08, 0, 0.085],
            [2.09, 0, 0.05],
            [2.08, 0, 0.015],
            [2.04, 0, 0.02],
          ],
        },
      ],
    });
    expect(gripped).toContain(CLEAN);
    // A part attached to the pot, against its side, moves with it, held.
    const tagged = await done("blender_add_objects", {
      objects: [
        {
          name: "Tag",
          kind: "box",
          size: [0.04, 0.01, 0.01],
          location: [2.07, 0, 0.05],
          parent: "Pot",
        },
      ],
    });
    expect(tagged).toContain(CLEAN);
    // The post taken away, what it held is said to float.
    const moved = await done("blender_edit_objects", {
      edits: [{ object: "Post", location: [1, 0.5, 0.05] }],
    });
    expect(faultsOf(moved, "Plank")).toContain("held by nothing");

    const hidden = await done("blender_add_objects", {
      objects: [
        {
          name: "Bolt",
          kind: "box",
          size: [0.01, 0.01, 0.01],
          location: [0, 0, 0.05],
        },
      ],
    });
    expect(faultsOf(hidden, "Bolt")).toContain(
      "lies wholly inside Mug's solid, hidden unless Mug is see-through",
    );
    const beside = await done("blender_add_objects", {
      objects: [
        {
          name: "Nut",
          kind: "box",
          size: [0.01, 0.01, 0.01],
          location: [0.1, 0, 0.015],
        },
      ],
    });
    expect(faultsOf(beside, "Nut")).not.toContain("wholly inside");
    // A support hidden from pictures holds nothing in them.
    const unheld = await done("blender_edit_objects", {
      edits: [{ object: "Leg", hidden: true }],
    });
    expect(faultsOf(unheld, "Shelf")).toContain("held by nothing");
  }, 120_000);

  it("says a part tips only where it stands on what lies under it", async () => {
    await done("blender_open_scene", { path: "walls.blend", create: true });
    // Held against a wall with nothing under them, they stand on nothing.
    const hung = await done("blender_add_objects", {
      objects: [
        {
          name: "Wall",
          kind: "box",
          size: [3, 0.1, 2.5],
          location: [0, 2, 1.25],
        },
        {
          name: "Ledge",
          kind: "box",
          size: [0.8, 0.25, 0.03],
          location: [0, 1.825, 1.2],
        },
        {
          name: "Clock",
          kind: "cylinder",
          size: [0.3, 0.3, 0.04],
          rotation: [90, 0, 0],
          location: [1, 1.93, 1.8],
        },
        {
          name: "Picture",
          kind: "box",
          size: [0.8, 0.03, 0.6],
          location: [-1, 1.935, 1.6],
        },
      ],
    });
    expect(hung).not.toContain("would tip");
    // What rests on top of a ledge does not stand it up.
    const topped = await done("blender_add_objects", {
      objects: [
        {
          name: "Novel",
          kind: "box",
          size: [0.15, 0.2, 0.03],
          location: [0, 1.85, 1.23],
          rest_on: "Ledge",
        },
      ],
    });
    expect(topped).not.toContain("would tip");
    // A board standing on the floor and leaning on the wall is held by both.
    const leaning = await done("blender_add_objects", {
      objects: [
        {
          name: "Board",
          kind: "box",
          size: [0.4, 0.02, 1],
          rotation: [-15, 0, 0],
          location: [-1, 1.95 - 0.1390688, 0.4855512],
        },
      ],
    });
    expect(faultsOf(leaning, "Board")).toBe("");
    // A plank overhanging its post tips, a brick on its top or not.
    const overhung = await done("blender_add_objects", {
      objects: [
        {
          name: "Post",
          kind: "box",
          size: [0.05, 0.05, 0.1],
          location: [3, 0, 0.05],
        },
        {
          name: "Plank",
          kind: "box",
          size: [0.4, 0.05, 0.02],
          location: [3.15, 0, 0.11],
        },
        {
          name: "Brick",
          kind: "box",
          size: [0.1, 0.05, 0.05],
          location: [3.15, 0, 0.145],
        },
      ],
    });
    expect(faultsOf(overhung, "Plank")).toMatch(
      /would tip over toward \+x: its centre of mass, at \(3\.15, 0, 0\.11 m\), is 125 mm beyond where it stands on Post\./,
    );
    expect(faultsOf(overhung, "Brick")).toBe("");
    // An open bowl's centre of mass is the middle of its surface, wherever it is.
    const bowl = await done("blender_add_objects", {
      objects: [
        {
          name: "Bowl",
          kind: "revolve",
          profile: [
            [0, 0],
            [0.05, 0],
            [0.09, 0.04],
            [0.1, 0.07],
          ],
          location: [5, 0, 0],
        },
      ],
    });
    expect(faultsOf(bowl, "Bowl")).not.toContain("would tip");
  }, 120_000);

  it("says nothing hidden of what lies inside something see-through", async () => {
    await done("blender_open_scene", { path: "drink.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Water",
          kind: "box",
          size: [0.08, 0.08, 0.1],
          location: [0, 0, 0.05],
        },
        {
          name: "Stone",
          kind: "box",
          size: [0.08, 0.08, 0.1],
          location: [1, 0, 0.05],
        },
      ],
    });
    await done("blender_set_material", {
      objects: ["Water"],
      material: { name: "Water", transmission: 1, ior: 1.33, roughness: 0.05 },
    });
    const ice = await done("blender_add_objects", {
      objects: [
        {
          name: "Ice",
          kind: "box",
          size: [0.02, 0.02, 0.02],
          location: [0, 0, 0.05],
        },
        {
          name: "Fossil",
          kind: "box",
          size: [0.02, 0.02, 0.02],
          location: [1, 0, 0.05],
        },
      ],
    });
    expect(faultsOf(ice, "Ice")).not.toContain("wholly inside");
    expect(faultsOf(ice, "Fossil")).toContain(
      "lies wholly inside Stone's solid, hidden unless Stone is see-through",
    );
  }, 120_000);

  it("says a floating object's pieces float once", async () => {
    await done("blender_open_scene", { path: "word.blend", create: true });
    const word = await done("blender_add_objects", {
      objects: [
        {
          name: "Sign",
          kind: "text",
          text: "Hello",
          height: 0.1,
          depth: 0.01,
          location: [0, 0, 0.5],
        },
        {
          name: "Base",
          kind: "box",
          size: [1, 1, 0.1],
          location: [2, 0, 0.05],
        },
      ],
    });
    expect(faultsOf(word, "Sign")).toMatch(
      /^- Sign: held by nothing: its \d+ pieces touch no other shape/,
    );
  }, 120_000);

  it("finds no hole in an open sheet's outline, and finds a gap in a closed shape", async () => {
    await done("blender_open_scene", { path: "sheets.blend", create: true });
    const sheet = await script([
      "import bpy",
      "bpy.ops.mesh.primitive_grid_add(x_subdivisions=80, y_subdivisions=80, size=2, location=(0, 0, 0))",
      "bpy.context.active_object.name = 'Ground'",
    ]);
    expect(faultsOf(sheet, "Ground")).toBe("");
    const holed = await script([
      ...meshMaker,
      "def gapped(b):",
      "    bmesh.ops.create_icosphere(b, subdivisions=3, radius=0.1)",
      "    b.faces.ensure_lookup_table()",
      "    top = max(b.faces, key=lambda f: f.calc_center_median().z)",
      "    bmesh.ops.delete(b, geom=[top], context='FACES_ONLY')",
      "made('Gapped', gapped, (3, 0, 0.1))",
      "def flagged(b):",
      "    gapped(b)",
      "    bmesh.ops.create_grid(b, x_segments=4, y_segments=4, size=0.05, matrix=mathutils.Matrix.Translation((0, 0.3, 0)))",
      "made('Flagged', flagged, (4, 0, 0.1))",
    ]);
    expect(faultsOf(holed, "Gapped")).toMatch(
      /1 hole in its surface, [\d.]+ mm across at \(/,
    );
    // A sheet beside it leaves the closed piece's gap told.
    expect(faultsOf(holed, "Flagged")).toMatch(
      /1 hole in its surface, [\d.]+ mm across at \(/,
    );
  }, 120_000);

  it("names a scale that mirrors a shape or stretches its steps' widths", async () => {
    await done("blender_open_scene", { path: "scales.blend", create: true });
    const scaled = await script([
      ...meshMaker,
      "made('Mirrored', cube, (0, 0, 0.05)).scale = (-1, 1, 1)",
      "tall = made('Tall', cube, (1, 0, 0.15))",
      "tall.scale = (1, 1, 3)",
      "tall.modifiers.new('Bevel', 'BEVEL').width = 0.005",
      "made('Even', cube, (2, 0, 0.1)).scale = (2, 2, 2)",
    ]);
    expect(faultsOf(scaled, "Mirrored")).toContain(
      "its scale is negative, which mirrors it",
    );
    expect(faultsOf(scaled, "Tall")).toContain(
      "it is scaled unevenly, (1, 1, 3), so the widths of Bevel stretch with it",
    );
    expect(faultsOf(scaled, "Even")).toBe("");
  }, 120_000);

  it("names the values in a material no real surface has, and pictures read wrongly or missing", async () => {
    await done("blender_open_scene", { path: "materials.blend", create: true });
    await script([
      "import bpy",
      "for name in ('grain.png', 'bricks_normal_dx.png', 'bricks_normal_gl.png', 'rough.png'):",
      "    picture = bpy.data.images.new(name, 8, 8)",
      "    picture.filepath_raw = '//' + name",
      "    picture.file_format = 'PNG'",
      "    picture.save()",
      "    bpy.data.images.remove(picture)",
    ]);
    await done("blender_add_objects", {
      objects: [
        {
          name: "Pot",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [0, 0, 0.05],
        },
        {
          name: "Pan",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [1, 0, 0.05],
        },
        {
          name: "Wall",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [2, 0, 0.05],
        },
      ],
    });
    const unreal = await done("blender_set_material", {
      objects: ["Pot"],
      material: { name: "Odd", color: "#000000", metallic: 0.5, ior: 3.5 },
    });
    const odd = faultsOf(unreal, "Material Odd");
    expect(odd).toContain("metallic 0.5 is neither metal nor not");
    expect(odd).toContain(
      "its metal colour #000000 reflects 0.0% of light, darker than any metal",
    );
    expect(odd).toContain(
      "its ior 3.5 bends light more than any clear material: diamond's is 2.42",
    );
    const black = await done("blender_set_material", {
      objects: ["Pot"],
      material: { name: "Soot", color: "#020202", roughness: 0 },
    });
    expect(faultsOf(black, "Material Soot")).toContain(
      "less than any real surface: charcoal reflects about 4%",
    );
    expect(faultsOf(black, "Material Soot")).toContain(
      "its roughness 0 makes a perfect mirror of an opaque surface",
    );
    const white = await done("blender_set_material", {
      objects: ["Pot"],
      material: { name: "Snowier", color: "#ffffff" },
    });
    expect(faultsOf(white, "Material Snowier")).toContain(
      "its colour #ffffff reflects 100.0% of light, more than any real surface: fresh snow reflects about 90%",
    );
    // A saturated paint reflects far less than white: it is a real surface.
    for (const color of ["#ff0000", "#ffcc00", "#00a0ff"]) {
      const paint = await done("blender_set_material", {
        objects: ["Pot"],
        material: { name: `Paint ${color}`, color, roughness: 0.4 },
      });
      expect(paint).toContain(CLEAN);
    }
    const air = await done("blender_set_material", {
      objects: ["Pot"],
      material: { name: "Air glass", transmission: 1, ior: 1 },
    });
    expect(faultsOf(air, "Material Air glass")).toContain(
      "its ior 1 bends no light, so it shows as no glass at all",
    );
    const glass = await done("blender_set_material", {
      objects: ["Pot"],
      material: { name: "Glass", transmission: 1, ior: 1.5, roughness: 0 },
    });
    expect(glass).toContain(CLEAN);
    const finished = await done("blender_set_material", {
      objects: ["Pan"],
      material: { name: "Iron", finish: "cast-iron", wear: 0.4 },
    });
    expect(finished).toContain(CLEAN);
    const relief = await done("blender_set_material", {
      objects: ["Wall"],
      material: {
        name: "Bricks",
        color: "#8a4b3c",
        normal_map: { path: "bricks_normal_dx.png" },
      },
    });
    // Read as DirectX from its name, it shows its relief the right way up.
    expect(relief).toContain(CLEAN);
    const opengl = await done("blender_set_material", {
      objects: ["Wall"],
      material: {
        name: "Bricks GL",
        color: "#8a4b3c",
        normal_map: { path: "bricks_normal_gl.png" },
      },
    });
    expect(opengl).toContain(CLEAN);
    const wrong = await script([
      "import bpy",
      "tree = bpy.data.materials['Bricks GL'].node_tree",
      "shader = tree.nodes['Principled BSDF']",
      "colour = tree.nodes.new('ShaderNodeTexImage')",
      "colour.image = bpy.data.images.load(bpy.path.abspath('//grain.png'))",
      "colour.image.colorspace_settings.name = 'Non-Color'",
      "tree.links.new(colour.outputs['Color'], shader.inputs['Base Color'])",
      "rough = tree.nodes.new('ShaderNodeTexImage')",
      "rough.image = bpy.data.images.load(bpy.path.abspath('//rough.png'))",
      "tree.links.new(rough.outputs['Color'], shader.inputs['Roughness'])",
      "gone = tree.nodes.new('ShaderNodeTexImage')",
      "gone.image = bpy.data.images.load(bpy.path.abspath('//rough.png'), check_existing=False)",
      "gone.image.filepath = '//gone.png'",
      "tree.links.new(gone.outputs['Color'], shader.inputs['Metallic'])",
      "tree.nodes.new('ShaderNodeBsdfDiffuse').name = 'Spare'",
      "relief = next(n for n in tree.nodes if n.type == 'NORMAL_MAP')",
      "relief.convention = 'OPENGL'",
      "relief.inputs['Color'].links[0].from_node.image = bpy.data.images.load(bpy.path.abspath('//bricks_normal_dx.png'))",
    ]);
    expect(faultsOf(wrong, "Material Bricks GL")).toContain(
      "its normal map bricks_normal_dx.png is named as one made for DirectX, whose green runs the other way from Blender's, but is read as OpenGL, so its relief shows inverted: set its Normal Map node's convention to DirectX",
    );
    const bricks = faultsOf(wrong, "Material Bricks GL");
    expect(bricks).toContain(
      "its colour picture grain.png is read as data (Non-Color), so its colours show washed out: set it to sRGB",
    );
    expect(bricks).toContain(
      "its picture rough.png gives data but is read as colour (sRGB), so its values are bent: set it to Non-Color",
    );
    expect(bricks).toMatch(/its picture gone\.png is missing from .*gone\.png/);
    expect(bricks).toContain("its Spare feeds nothing it shows");
    // Glass is previewed by Cycles, whose kernels a new conversation builds first.
  }, 600_000);

  it("checks how a shape lies in a picture laid by its layout", async () => {
    await done("blender_open_scene", { path: "layouts.blend", create: true });
    await script([
      "import bpy",
      "picture = bpy.data.images.new('grain.png', 8, 8)",
      "picture.filepath_raw = '//grain.png'",
      "picture.file_format = 'PNG'",
      "picture.save()",
    ]);
    await done("blender_add_objects", {
      objects: [
        {
          name: "Beam",
          kind: "box",
          size: [1, 0.1, 0.1],
          location: [0, 0, 0.05],
        },
        {
          name: "Cube",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [0, 1, 0.05],
        },
        {
          name: "Bare",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [0, 2, 0.05],
        },
        {
          name: "Crate",
          kind: "box",
          size: [0.2, 0.5, 1],
          location: [3, 0, 0.5],
        },
        { name: "Floor", kind: "plane", size: [4, 1], location: [0, -3, 0] },
        {
          name: "Rod",
          kind: "cylinder",
          size: [0.05, 0.05, 1],
          location: [3, 1, 0.5],
        },
        {
          name: "Disc",
          kind: "cylinder",
          size: [1, 1, 0.05],
          location: [3, 3, 0.025],
        },
        {
          name: "Spike",
          kind: "cone",
          size: [0.3, 0.3, 0.5],
          location: [5, 0, 0.25],
        },
        {
          name: "Ball",
          kind: "sphere",
          size: [0.5, 0.5, 0.5],
          location: [5, 2, 0.25],
        },
        {
          name: "Egg",
          kind: "sphere",
          size: [0.2, 0.2, 0.3],
          location: [5, 3, 0.15],
        },
      ],
    });
    const typed = ["Crate", "Floor", "Rod", "Disc", "Spike", "Ball", "Egg"];
    const laid = await done("blender_set_material", {
      objects: ["Beam", "Cube", "Bare", ...typed],
      material: { name: "Grain", texture: { path: "grain.png" } },
    });
    // Each shape adding makes lays its picture at its real proportions and
    // at one scale over it; a sphere's by longitude and latitude, gathered at
    // its poles by its nature.
    expect(laid).toContain(CLEAN);
    // Drawn out by a script to three times its length, its picture stretches with it.
    const drawn = await script([
      "import bpy, mathutils",
      "bpy.data.objects['Beam'].data.transform(mathutils.Matrix.Diagonal((3, 1, 1, 1)))",
    ]);
    expect(faultsOf(drawn, "Beam")).toMatch(
      /its picture is stretched on 9\d% of its surface, running up to 3 times further one way than across/,
    );
    const folded = await script([
      "import bpy",
      "uv = bpy.data.objects['Cube'].data.uv_layers.active.uv",
      "for i in range(8):",
      "    uv[i].vector = (0.1, 0.1)",
    ]);
    expect(faultsOf(folded, "Cube")).toMatch(
      /4 of its triangles have no room in its picture, so each shows one colour, as at \(/,
    );
    const stacked = await script([
      "import bpy",
      "mesh = bpy.data.objects['Cube'].data",
      "square = [(0, 0), (1, 0), (1, 1), (0, 1)]",
      "for face in mesh.polygons:",
      "    for corner, loop in enumerate(face.loop_indices):",
      "        mesh.uv_layers.active.uv[loop].vector = square[corner]",
    ]);
    // Faces sharing room in the picture each show the whole of it, as tiles do.
    expect(faultsOf(stacked, "Cube")).toBe("");
    const turned = await script([
      "import bpy",
      "mesh = bpy.data.objects['Cube'].data",
      "square = [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)]",
      "for index, face in enumerate(mesh.polygons):",
      "    for corner, loop in enumerate(face.loop_indices):",
      "        u, v = square[corner]",
      "        mesh.uv_layers.active.uv[loop].vector = (0.15 * index + (0.1 - u if index == 0 else u), v)",
    ]);
    expect(faultsOf(turned, "Cube")).toMatch(
      /2 of its triangles are turned over in its picture, so the picture shows mirrored there, as at \(/,
    );
    const mirrored = await script([
      "import bpy",
      "mesh = bpy.data.objects['Cube'].data",
      "square = [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)]",
      "for index, face in enumerate(mesh.polygons):",
      "    for corner, loop in enumerate(face.loop_indices):",
      "        u, v = square[corner]",
      "        mesh.uv_layers.active.uv[loop].vector = (0.15 * index + 0.1 - u, v)",
    ]);
    expect(faultsOf(mirrored, "Cube")).toBe(
      "- Cube: its whole layout is turned over, so the picture shows mirrored on it.",
    );
    // Each face its own square, one of them ten times as large as the rest.
    const uneven = await script([
      "import bpy",
      "mesh = bpy.data.objects['Cube'].data",
      "for index, face in enumerate(mesh.polygons):",
      "    side = 0.4 if index == 0 else 0.04",
      "    square = [(0, 0), (side, 0), (side, side), (0, side)]",
      "    for corner, loop in enumerate(face.loop_indices):",
      "        u, v = square[corner]",
      "        mesh.uv_layers.active.uv[loop].vector = (0.45 * (index > 0) + 0.05 * index + u, v)",
    ]);
    expect(faultsOf(uneven, "Cube")).toMatch(
      /its picture's detail per centimetre varies 10 times over its surface/,
    );
    const unlaid = await script([
      "import bpy",
      "mesh = bpy.data.objects['Bare'].data",
      "mesh.uv_layers.remove(mesh.uv_layers[0])",
    ]);
    expect(faultsOf(unlaid, "Bare")).toContain(
      "a material on it lays a picture by its layout, and it has none, so the picture shows as one colour",
    );
  }, 120_000);

  it("takes a picture repeated by the shape's own steps, and refuses one on a layout that does not fit", async () => {
    await done("blender_open_scene", { path: "tiles.blend", create: true });
    await script([
      "import bpy",
      "picture = bpy.data.images.new('planks.png', 8, 8)",
      "picture.filepath_raw = '//planks.png'",
      "picture.file_format = 'PNG'",
      "picture.save()",
    ]);
    await done("blender_add_objects", {
      objects: [
        {
          name: "Plank",
          kind: "box",
          size: [1, 0.1, 0.02],
          location: [0, 2, 0.01],
        },
        {
          name: "Half",
          kind: "box",
          size: [0.3, 0.2, 0.2],
          location: [0.3, 3, 0.1],
        },
        {
          name: "Word",
          kind: "text",
          text: "Hello",
          height: 0.1,
          depth: 0.01,
          location: [3, 0, 0.005],
        },
        {
          name: "Plate",
          kind: "outline",
          points: [
            [0, 0],
            [0.4, 0],
            [0.4, 0.3],
            [0, 0.3],
          ],
          height: 0.01,
          location: [4, 0, 0],
        },
      ],
    });
    await done("blender_set_material", {
      objects: ["Plank", "Half"],
      material: { name: "Planks", texture: { path: "planks.png" } },
    });
    const repeated = await done("blender_shape_objects", {
      object: "Plank",
      operations: [{ kind: "array", count: 6, offset: [0, 0.11, 0] }],
    });
    expect(repeated).toContain(CLEAN);
    const halves = await done("blender_shape_objects", {
      object: "Half",
      operations: [{ kind: "mirror", axes: ["x"], across: "Plank" }],
    });
    expect(halves).toContain(CLEAN);
    // Lettering and an outline have no layout a picture fits, as a ring has none.
    for (const material of [
      { name: "Grain", texture: { path: "planks.png", projection: "uv" } },
      { name: "Planks" },
    ]) {
      const refused = await call("blender_set_material", {
        objects: ["Word", "Plate"],
        material,
      });
      expect(refused.isError, refused.said).toBe(true);
      expect(refused.said).toContain(
        "Word, Plate has no layout that fits a uv picture, which would show stretched, mirrored or as one colour; use cylinder, box, sphere or front.",
      );
    }
    const boxed = await done("blender_set_material", {
      objects: ["Word", "Plate"],
      material: {
        name: "Boxed",
        texture: { path: "planks.png", projection: "box" },
      },
    });
    expect(boxed).toContain(CLEAN);
  }, 120_000);

  it("answers each shaping step from what it measured on the shape", async () => {
    await done("blender_open_scene", { path: "shaping.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Plank",
          kind: "box",
          size: [0.4, 0.05, 0.02],
          location: [0, 0, 0.01],
        },
        {
          name: "Slat",
          kind: "box",
          size: [0.1, 0.05, 0.02],
          location: [0, 1, 0.01],
        },
        {
          name: "Half",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [1.1, 0, 0.05],
        },
        {
          name: "Crate",
          kind: "box",
          size: [0.3, 0.3, 0.3],
          location: [0, 2, 0.15],
        },
        {
          name: "Cage",
          kind: "box",
          size: [0.2, 0.2, 0.2],
          location: [0, 3, 0.1],
        },
        {
          name: "Ball",
          kind: "sphere",
          size: [0.1, 0.1, 0.1],
          location: [0, 4, 0.05],
        },
      ],
    });
    const blunt = await call("blender_shape_objects", {
      object: "Plank",
      operations: [{ kind: "bevel", width: 0.002, angle: 120 }],
    });
    expect(blunt.isError).toBe(true);
    expect(blunt.said).toContain(
      "The bevel rounds nothing on “Plank”: none of its edges is sharper than 120°, the bevel's angle; its sharpest is 90°.",
    );
    const round = await call("blender_shape_objects", {
      object: "Ball",
      operations: [{ kind: "bevel", width: 0.002 }],
    });
    expect(round.isError).toBe(true);
    expect(round.said).toMatch(/its sharpest is 5\.6\d°/);
    expect(
      await done("blender_shape_objects", {
        object: "Plank",
        operations: [{ kind: "bevel", width: 0.002 }],
      }),
    ).toContain("Plank: 12 edges rounded by 2 mm");

    expect(
      await done("blender_shape_objects", {
        object: "Slat",
        operations: [{ kind: "array", count: 3, offset: [0.15, 0, 0] }],
      }),
    ).toContain("repeated 3 times, 150 mm apart, 50 mm between them");
    const crowded = await done("blender_shape_objects", {
      object: "Slat",
      operations: [
        { kind: "remove", modifier: "Array" },
        { kind: "array", count: 3, offset: [0.08, 0, 0] },
      ],
    });
    expect(crowded).toContain(
      "Array removed, from 18 faces to 6, its size from 400 × 50 × 20 mm to 100 × 50 × 20 mm",
    );
    expect(crowded).toContain(
      "repeated 3 times, 80 mm apart, each going 20 mm into the next",
    );
    const nowhere = await call("blender_shape_objects", {
      object: "Half",
      operations: [{ kind: "array", count: 3, offset: [0, 0, 0] }],
    });
    expect(nowhere.isError).toBe(true);
    expect(nowhere.said).toContain("[0, 0, 0] puts them all in one place");

    expect(
      await done("blender_shape_objects", {
        object: "Crate",
        operations: [{ kind: "mirror", axes: ["x"] }],
      }),
    ).toContain(
      "mirrored across x, which changes nothing: it was already the same on both sides of its mirror",
    );
    expect(
      await done("blender_shape_objects", {
        object: "Half",
        operations: [{ kind: "mirror", axes: ["x"], across: "Plank" }],
      }),
    ).toContain("mirrored across x; its halves across x stand 2.1 m apart");

    expect(
      await done("blender_shape_objects", {
        object: "Crate",
        operations: [{ kind: "solidify", thickness: 0.01 }],
      }),
    ).toContain(
      "walls 10 mm thick, hollow inside and sealed, so it looks as before: its volume went from 27 L to 5.048 L",
    );

    const subdivided = await done("blender_shape_objects", {
      object: "Cage",
      operations: [{ kind: "subdivision", levels: 2 }],
    });
    expect(subdivided).toContain(
      "subdivided 2 times, from 6 faces to 96, shrinking it from 200 × 200 × 200 mm to 167.9 × 167.9 × 167.9 mm",
    );
    expect(subdivided).toContain(
      "Now Cage (167.9 × 167.9 × 167.9 mm) at (0, 3, 0.1 m), from 16.05 mm to 184 mm high",
    );
    expect(
      await done("blender_shape_objects", {
        object: "Cage",
        operations: [{ kind: "smooth" }],
      }),
    ).toContain(
      // The step shades the subdivided surface, whose faces meet at less than 30°.
      "smoothed, no edge sharper than 30°, by a Smooth by Angle step kept last",
    );
  }, 120_000);

  it("says what a resize did to a part's round hole, and what copies go into", async () => {
    await done("blender_open_scene", { path: "editing.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Plate",
          kind: "box",
          size: [0.2, 0.1, 0.01],
          location: [0, 0, 0.005],
        },
      ],
    });
    await done("blender_shape_objects", {
      object: "Plate",
      operations: [
        {
          kind: "boolean",
          cutter: {
            shape: "cylinder",
            diameter: 0.01,
            depth: 0.02,
            location: [0, 0, 0.005],
          },
        },
      ],
    });
    const stretched = await done("blender_edit_objects", {
      edits: [{ object: "Plate", size: [0.3, 0.1, 0.01] }],
    });
    expect(stretched).toContain(
      "its hole Plate cutter 1 stretched with it from 10 × 10 × 20 mm to 15 × 10 × 20 mm, no longer round",
    );
    const even = await done("blender_edit_objects", {
      edits: [{ object: "Plate", size: [0.6, 0.2, 0.02] }],
    });
    // An even resize keeps a hole's shape, and says nothing of it.
    expect(even).not.toContain("Plate cutter 1");

    await done("blender_add_objects", {
      objects: [
        {
          name: "Tile",
          kind: "box",
          size: [0.1, 0.1, 0.01],
          location: [2, 0, 0.005],
        },
      ],
    });
    const copied = await done("blender_edit_objects", {
      edits: [
        { object: "Tile", duplicate: { count: 2, offset: [0.05, 0, 0] } },
      ],
    });
    expect(copied).toMatch(
      /copied as Tile 2 at \(2\.05, 0, 0\.005 m\), from 0 mm to 10 mm high, goes [\d.]+ mm into Tile\b[^;]*; Tile 3 at \(2\.1, 0, 0\.005 m\), from 0 mm to 10 mm high/,
    );

    // Mirrored across a hub half a metre away, a wing's halves stay a metre
    // apart however small its own shape: the size it reaches is said.
    await done("blender_add_objects", {
      objects: [
        {
          name: "Hub",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [4, 0, 0.05],
        },
        {
          name: "Wing",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [4.5, 0, 0.05],
        },
      ],
    });
    await script([
      "import bpy",
      "pair = bpy.data.objects['Wing'].modifiers.new('Pair', 'MIRROR')",
      "pair.mirror_object = bpy.data.objects['Hub']",
    ]);
    const short = await done("blender_edit_objects", {
      edits: [{ object: "Wing", size: [0.5, 0.1, 0.1] }],
    });
    expect(short).toMatch(
      /Wing: resized from [\d.]+ × [\d.]+ × [\d.]+ m+, reaching 1\.0\d+ × 0\.1 × 0\.1 m, not the 500 × 100 × 100 mm asked[,;]/,
    );
  }, 120_000);

  it("aims the axis asked, and says when a shape's length lies across its aim", async () => {
    await done("blender_open_scene", { path: "aim.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Rod",
          kind: "cylinder",
          size: [0.01, 0.01, 0.2],
          location: [0, 0, 0.1],
        },
        {
          name: "Piston",
          kind: "box",
          size: [0.05, 0.05, 0.05],
          location: [0.3, 0, 0.1],
        },
      ],
    });
    const front = await done("blender_animate", {
      aim: [{ object: "Rod", at: "Piston" }],
    });
    expect(front).toContain(
      "Rod: aims its -y axis at Piston wherever either moves; its length runs along its z axis, across that line: give facing z or -z to aim its length",
    );
    const along = await done("blender_animate", {
      aim: [{ object: "Rod", at: "Piston", facing: "z" }],
    });
    expect(along).toContain(
      "Rod: aims its z axis at Piston wherever either moves.",
    );
    const pointing = await script([
      "import bpy, mathutils",
      "rod, piston = bpy.data.objects['Rod'], bpy.data.objects['Piston']",
      "axis = rod.matrix_world.to_3x3() @ mathutils.Vector((0, 0, 1))",
      "print('off', round(axis.angle(piston.matrix_world.translation - rod.matrix_world.translation), 4))",
    ]);
    expect(pointing).toContain("off 0.0");

    // A vase drawn from its base has its origin there: the aim goes to it,
    // and says how far that is from the vase's middle.
    await done("blender_add_objects", {
      objects: [
        {
          name: "Lamp",
          kind: "box",
          size: [0.05, 0.05, 0.05],
          location: [0, 2, 0],
        },
        {
          name: "Vase",
          kind: "revolve",
          profile: [
            [0, 0],
            [0.05, 0],
            [0.05, 0.3],
            [0, 0.3],
          ],
          location: [1, 2, 0],
        },
      ],
    });
    const based = await done("blender_animate", {
      aim: [{ object: "Lamp", at: "Vase" }],
    });
    expect(based).toContain(
      "Lamp: aims its -y axis at Vase wherever either moves, at its origin, (1, 2, 0 m), which lies 8.53° off its middle as seen from Lamp.",
    );

    // Almost straight up, the aim has no way to keep it upright.
    await done("blender_add_objects", {
      objects: [
        {
          name: "Hook",
          kind: "box",
          size: [0.02, 0.02, 0.02],
          location: [2, 0, 0.1],
        },
        {
          name: "Bulb",
          kind: "box",
          size: [0.02, 0.02, 0.02],
          location: [2.01, 0, 1.1],
        },
      ],
    });
    const overhead = await done("blender_animate", {
      aim: [{ object: "Hook", at: "Bulb" }],
    });
    expect(overhead).toContain(
      "Hook: aims its -y axis at Bulb wherever either moves; the line to it runs 0.573° from straight up, where an aim cannot keep it upright: a small move across that line turns it round the line, up to half a turn.",
    );
    // What a small move across it does.
    const turned = await script([
      "import bpy",
      "hook, bulb = bpy.data.objects['Hook'], bpy.data.objects['Bulb']",
      "before = hook.matrix_world.to_euler().z",
      "bulb.location.x, bulb.location.y = 2, 0.01",
      "bpy.context.view_layer.update()",
      "turn = abs(hook.matrix_world.to_euler().z - before) * 180 / 3.14159 % 360",
      "print('turned', round(min(turn, 360 - turn)))",
    ]);
    expect(turned).toContain("turned 90");
  }, 120_000);

  it("names what it left unchecked when a call's checks pass their time", async () => {
    await done("blender_open_scene", { path: "beads.blend", create: true });
    // Three thousand beads, each checked on its own, take far past 20 s.
    const strung = await script([
      "import bpy, bmesh",
      "b = bmesh.new()",
      "bmesh.ops.create_uvsphere(b, u_segments=32, v_segments=16, radius=0.02)",
      "m = bpy.data.meshes.new('Bead')",
      "b.to_mesh(m)",
      "b.free()",
      "for i in range(3000):",
      "    o = bpy.data.objects.new(f'Bead {i}', m)",
      "    o.location = ((i % 60) * 0.05, (i // 60) * 0.05, 0.02)",
      "    bpy.context.scene.collection.objects.link(o)",
    ]);
    expect(strung).toMatch(
      /Not checked, past the 20 s the checks of a call have: Bead \d+, (Bead \d+, ){4}Bead \d+ and \d+ more\./,
    );
  }, 300_000);

  it("says when an opened scene counts its units otherwise than in metres", async () => {
    await done("blender_open_scene", {
      path: "centimetres.blend",
      create: true,
    });
    await script([
      "import bpy",
      "bpy.context.scene.unit_settings.scale_length = 0.01",
    ]);
    await done("blender_open_scene", { path: "metres.blend", create: true });
    const opened = await done("blender_open_scene", {
      path: "centimetres.blend",
    });
    expect(opened).toContain(
      "Its unit scale is 0.01: Blender shows each of its units as 10 mm, and every size the tools give or take counts one as 1 m.",
    );
    const plain = await done("blender_open_scene", { path: "metres.blend" });
    expect(plain).not.toContain("unit scale");
    await done("blender_open_scene", { path: "imperial.blend", create: true });
    await script([
      "import bpy",
      "bpy.context.scene.unit_settings.system = 'IMPERIAL'",
    ]);
    await done("blender_open_scene", { path: "metres.blend" });
    const imperial = await done("blender_open_scene", {
      path: "imperial.blend",
    });
    expect(imperial).toContain(
      "It shows its sizes in feet and inches, and the tools give and take metres.",
    );
  }, 120_000);

  it("checks a layout only where a material lays a picture by it", async () => {
    await done("blender_open_scene", { path: "joined.blend", create: true });
    await script([
      "import bpy",
      "picture = bpy.data.images.new('grain.png', 8, 8)",
      "picture.filepath_raw = '//grain.png'",
      "picture.file_format = 'PNG'",
      "picture.save()",
    ]);
    await done("blender_add_objects", {
      objects: [
        {
          name: "Floor",
          kind: "box",
          size: [2, 2, 0.1],
          location: [0, 0, 0.05],
        },
        {
          name: "Wall",
          kind: "box",
          size: [2, 0.1, 1],
          location: [0, 1.05, 0.5],
        },
      ],
    });
    // Joined, and two of its faces given no room in the layout: with no
    // picture laid by it, the layout is nothing to check.
    const joined = await script([
      "import bpy",
      "for o in bpy.context.scene.objects: o.select_set(o.name in ('Floor', 'Wall'))",
      "bpy.context.view_layer.objects.active = bpy.data.objects['Floor']",
      "bpy.ops.object.join()",
      "room = bpy.data.objects['Floor']",
      "room.name = 'Room'",
      "uv = room.data.uv_layers.active.uv",
      "for i in range(8):",
      "    uv[i].vector = (0.1, 0.1)",
    ]);
    expect(joined).not.toContain("in its picture");
    const pictured = await script([
      "import bpy",
      "grain = bpy.data.materials.new('Grain')",
      "grain.use_nodes = True",
      "tree = grain.node_tree",
      "picture = tree.nodes.new('ShaderNodeTexImage')",
      "picture.image = bpy.data.images.load(bpy.path.abspath('//grain.png'))",
      "tree.links.new(picture.outputs['Color'], tree.nodes['Principled BSDF'].inputs['Base Color'])",
      "bpy.data.objects['Room'].data.materials.append(grain)",
    ]);
    expect(faultsOf(pictured, "Room")).toMatch(
      /4 of its triangles have no room in its picture/,
    );
  }, 120_000);

  it("says like faults of many objects together, in an answer of bounded length", async () => {
    await done("blender_open_scene", { path: "crowd.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        { name: "Ground", kind: "plane", size: [6, 6], location: [2, 1.5, 0] },
      ],
    });
    await script([
      "import bpy, bmesh",
      "b = bmesh.new()",
      "bmesh.ops.create_cube(b, size=0.1)",
      "m = bpy.data.meshes.new('P')",
      "b.to_mesh(m)",
      "b.free()",
      "for i in range(300):",
      "    o = bpy.data.objects.new(f'P{i}', m)",
      "    o.location = ((i % 20) * 0.2, (i // 20) * 0.2, 0.05)",
      "    bpy.context.scene.collection.objects.link(o)",
    ]);
    const lifted = await script([
      "import bpy",
      "for o in bpy.data.objects:",
      "    if o.name.startswith('P'): o.location.z += 0.5",
    ]);
    expect(lifted).toContain(
      "Changed 300 objects: P ×300, from 500 mm to 600 mm high; each moved by (0, 0, 500 mm).",
    );
    expect(lifted).toContain(
      "- P ×300: held by nothing: it touches no other shape and its bottom is 500 mm above the floor;",
    );
    // Twelve are named where they stand; the rest are counted.
    expect(lifted).toMatch(
      /288 more touching nothing \(P ×288\), 500 mm to 500 mm above what is under them/,
    );
    expect(lifted.length).toBeLessThan(8000);
  }, 300_000);

  it("says what an edit or a script changed from what to what", async () => {
    await done("blender_open_scene", { path: "moves.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Coaster",
          kind: "box",
          size: [0.1, 0.1, 0.01],
          location: [0.25, 0, 0.005],
        },
        {
          name: "Mug",
          kind: "cylinder",
          size: [0.08, 0.08, 0.1],
          location: [0, 0, 0.05],
        },
      ],
    });
    const rested = await done("blender_edit_objects", {
      edits: [{ object: "Mug", location: [0.25, 0, 0.1], rest_on: "Coaster" }],
    });
    expect(rested).toContain(
      "Mug: moved from (0, 0, 50 mm), resting on Coaster, gap 0 mm; now Mug (80 × 80 × 100 mm) at (250, 0, 60 mm), from 10 mm to 110 mm high",
    );
    const resized = await done("blender_edit_objects", {
      edits: [{ object: "Coaster", size: [0.2, 0.2, 0.01] }],
    });
    expect(resized).toMatch(
      /Coaster: resized from 100 × 100 × 10 mm; now Coaster \(200 × 200 × 10 mm\)/,
    );
    const turned = await done("blender_edit_objects", {
      edits: [{ object: "Coaster", rotation: [0, 0, 45] }],
    });
    expect(turned).toContain("Coaster: turned from (0°, 0°, 0°); now");
    const copied = await done("blender_edit_objects", {
      edits: [{ object: "Mug", duplicate: { offset: [0.3, 0, 0] } }],
    });
    expect(copied).toContain(
      "Mug: copied as Mug 2 at (550, 0, 60 mm), from 10 mm to 110 mm high.",
    );
    const nudged = await script([
      "import bpy",
      "bpy.data.objects['Mug'].location.x += 0.02",
      "bpy.data.objects['Mug 2'].scale.z = 2",
    ]);
    expect(nudged).toMatch(
      /Changed Mug \(80 × 80 × 100 mm\) at \(270, 0, 60 mm\)[^\n]*; before, at \(250, 0, 60 mm\)\./,
    );
    expect(nudged).toMatch(
      /Changed Mug 2 \(80 × 80 × 200 mm\)[^\n]*; before, 80 × 80 × 100 mm\./,
    );
  }, 120_000);

  it("says how each object that moved stands, what touches nothing first, and those held alike together", async () => {
    await done("blender_open_scene", { path: "held-up.blend", create: true });
    const added = await done("blender_add_objects", {
      objects: [
        {
          name: "Floor",
          kind: "box",
          size: [6, 6, 0.1],
          location: [0, 0, -0.05],
        },
        {
          name: "Ceiling",
          kind: "box",
          size: [6, 6, 0.1],
          location: [0, 0, 2.55],
        },
        {
          name: "Wall",
          kind: "box",
          size: [6, 0.1, 2.5],
          location: [0, 3.05, 1.25],
        },
        {
          name: "Lamp",
          kind: "box",
          size: [0.3, 0.3, 0.4],
          location: [1, 0, 2.3],
        },
        {
          name: "Wall board",
          kind: "box",
          size: [0.8, 0.2, 0.02],
          location: [0, 2.9, 1.5],
        },
        {
          name: "Ball",
          kind: "sphere",
          size: [0.2, 0.2, 0.2],
          location: [-1, 0, 1.3],
        },
        {
          name: "Moth",
          kind: "box",
          size: [0.05, 0.05, 0.05],
          location: [2, 0, 0.6],
        },
      ],
    });
    // Ball's bottom is 1.2 m above the floor, Moth's 575 mm: the farthest first.
    expect(added).toContain(
      "Where what moved stands: Ball touches nothing, 1.2 m above Floor; Moth touches nothing, 575 mm above Floor; Ceiling rests on Wall; Floor rests on the floor; Lamp hangs from Ceiling; Wall rests on Floor, against Wall board; Wall board stands against Wall, nothing under it.",
    );

    const many = await script([
      "import bpy, bmesh",
      "for i in range(14):",
      "    mesh = bpy.data.meshes.new(f'Tile {i}')",
      "    shape = bmesh.new()",
      "    bmesh.ops.create_cube(shape, size=0.1)",
      "    shape.to_mesh(mesh)",
      "    shape.free()",
      "    tile = bpy.data.objects.new(f'Tile {i}', mesh)",
      "    tile.location = (-2.5 + i * 0.3, -2, 0.05)",
      "    bpy.context.scene.collection.objects.link(tile)",
    ]);
    expect(many).toContain(
      "Where what moved stands: 14 objects (Tile ×14) each rests on Floor.",
    );
  }, 120_000);

  it("says a sheet that only carries what lies on it is held by nothing, never that it hangs from those things", async () => {
    await done("blender_open_scene", { path: "carried.blend", create: true });
    const added = await done("blender_add_objects", {
      objects: [
        {
          name: "Floor",
          kind: "box",
          size: [6, 6, 0.1],
          location: [0, 0, -0.05],
        },
        {
          name: "Table",
          kind: "box",
          size: [1.2, 0.8, 0.75],
          location: [0, 0, 0.375],
        },
        // 2 mm above the table top, as a cloth laid by eye.
        {
          name: "Cloth",
          kind: "plane",
          size: [2.4, 1.4],
          location: [0, 0, 0.752],
        },
        {
          name: "Plate",
          kind: "box",
          size: [0.27, 0.27, 0.02],
          location: [-0.3, 0, 0.762],
        },
        {
          name: "Glass",
          kind: "cylinder",
          size: [0.08, 0.08, 0.1],
          location: [0.3, 0.2, 0.802],
        },
      ],
    });
    expect(added).toContain(
      "Where what moved stands: Cloth has Glass and Plate on it but nothing under it, 2 mm above Table; Floor rests on the floor; Glass rests on Cloth; Plate rests on Cloth; Table rests on Floor.",
    );
  }, 120_000);

  it("lays the picture adding laid out again when the edit tool resizes the shape, and leaves a layout a script made", async () => {
    await done("blender_open_scene", { path: "relaid.blend", create: true });
    await script([
      "import bpy",
      "picture = bpy.data.images.new('grain.png', 8, 8)",
      "picture.filepath_raw = '//grain.png'",
      "picture.file_format = 'PNG'",
      "picture.save()",
    ]);
    await done("blender_add_objects", {
      objects: [
        {
          name: "Box",
          kind: "box",
          size: [0.4, 0.2, 0.1],
          location: [0, 0, 0.05],
        },
        {
          name: "Pipe",
          kind: "cylinder",
          size: [0.1, 0.1, 0.5],
          location: [1, 0, 0.25],
        },
      ],
    });
    await done("blender_set_material", {
      objects: ["Box", "Pipe"],
      material: { name: "Grain", texture: { path: "grain.png" } },
    });
    const drawn = await done("blender_edit_objects", {
      edits: [
        { object: "Box", size: [1.2, 0.2, 0.1] },
        { object: "Pipe", size: [0.1, 0.1, 1.5] },
      ],
    });
    expect(drawn).toContain(
      "Box: resized from 400 × 200 × 100 mm, its picture laid out again at its new proportions;",
    );
    expect(drawn).toContain(
      "Pipe: resized from 100 × 100 × 500 mm, its picture laid out again at its new proportions;",
    );
    expect(drawn).toContain(CLEAN);
    // A layout of the script's own, half as wide, stays as the script made it.
    await script([
      "import bpy",
      "uv = bpy.data.objects['Box'].data.uv_layers.active.uv",
      "for corner in uv: corner.vector = (corner.vector[0] / 2, corner.vector[1])",
    ]);
    const stretched = await done("blender_edit_objects", {
      edits: [{ object: "Box", size: [2.4, 0.2, 0.1] }],
    });
    expect(stretched).not.toContain("laid out again");
    expect(faultsOf(stretched, "Box")).toMatch(/its picture is stretched/);
  }, 120_000);

  it("joins two boxes that share faces into one clean shape", async () => {
    await done("blender_open_scene", { path: "union.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "L1",
          kind: "box",
          size: [0.3, 0.1, 0.1],
          location: [3, 0, 0.05],
        },
        {
          name: "L2",
          kind: "box",
          size: [0.1, 0.3, 0.1],
          location: [3.1, 0.1, 0.05],
        },
      ],
    });
    const joined = await done("blender_shape_objects", {
      object: "L1",
      operations: [{ kind: "boolean", operation: "union", with: "L2" }],
    });
    expect(joined).toContain("Now L1 (300 × 300 × 100 mm)");
    expect(joined).toContain(CLEAN);

    // The step that cleans it holds no length, so the shape itself is resized.
    const resized = await done("blender_edit_objects", {
      edits: [{ object: "L1", size: [0.6, 0.6, 0.1] }],
    });
    expect(resized).toContain("L1: resized from 300 × 300 × 100 mm");
    const scale = await script([
      "import bpy",
      "print('scale', tuple(round(v, 6) for v in bpy.data.objects['L1'].scale))",
    ]);
    expect(scale).toContain("scale (1.0, 1.0, 1.0)");
  }, 120_000);

  it("keeps a call that leaves a slow shape alone quick, its preview drawn from the shape as evaluated", async () => {
    await done("blender_open_scene", { path: "slow.blend", create: true });
    // Its poles, where 200 faces meet, make it slow to subdivide: seconds at each evaluation.
    await script([
      "import bpy, bmesh",
      "b = bmesh.new()",
      "bmesh.ops.create_uvsphere(b, u_segments=200, v_segments=125, radius=0.5)",
      "m = bpy.data.meshes.new('Ball')",
      "b.to_mesh(m)",
      "b.free()",
      "o = bpy.data.objects.new('Ball', m)",
      "o.location = (0, 0, 0.5)",
      "bpy.context.scene.collection.objects.link(o)",
      "o.modifiers.new('Sub', 'SUBSURF').levels = 1",
    ]);
    // Each call waits for the preview of the one before it.
    await script(["print('nothing')"]);
    const started = Date.now();
    const box = await done("blender_add_objects", {
      objects: [
        {
          name: "Box",
          kind: "box",
          size: [0.2, 0.2, 0.2],
          location: [2, 0, 0.1],
        },
      ],
    });
    await script(["print('nothing')"]);
    expect(box).toContain("Added Box");
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 300_000);

  it("says a part that was the same on both sides and an edit left otherwise, and nothing of an edit that keeps it so", async () => {
    await done("blender_open_scene", { path: "symmetry.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Sym",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [0, 0, 0.05],
        },
        {
          name: "Even",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [0.5, 0, 0.05],
        },
      ],
    });
    const pulled = await script([
      "import bpy",
      "m = bpy.data.objects['Sym'].data",
      "for v in m.vertices:",
      "    if v.co.x > 0:",
      "        v.co.x += 0.02",
      "m.update()",
    ]);
    const lost = pulled
      .split("\n")
      .find((line) => line.startsWith("Symmetry lost: "));
    expect(lost).toMatch(
      /^Symmetry lost: Sym was the same on both sides of its own x = 0 and no longer is: across x its surface strays from its mirror by RMS [\d.]+ mm, up to 20 mm at \([-\d., ]+ mm\)\. If that is not meant, zhiyin\.symmetrize copies one half onto the other\.$/,
    );
    // It is said apart from the faults, as an edit may mean it.
    expect(faultsOf(pulled, "Sym")).toBe("");
    const again = await script([
      "import bpy",
      "m = bpy.data.objects['Sym'].data",
      "for v in m.vertices:",
      "    if v.co.x > 0:",
      "        v.co.x += 0.01",
      "m.update()",
    ]);
    expect(again).not.toContain("the same on both sides");
    const widened = await script([
      "import bpy",
      "m = bpy.data.objects['Even'].data",
      "for v in m.vertices:",
      "    v.co.x *= 1.5",
      "m.update()",
    ]);
    expect(widened).not.toContain("the same on both sides");
  }, 120_000);

  it("says an object a script renamed as renamed, a copy it made as added, and symmetry a renamed part lost", async () => {
    await done("blender_open_scene", { path: "renamed.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Block",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [0, 0, 0.05],
        },
        {
          name: "Wing",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [0.5, 0, 0.05],
        },
      ],
    });
    const renamed = await script([
      "import bpy",
      "bpy.data.objects['Block'].name = 'Brick'",
    ]);
    expect(renamed).toContain("Renamed Block to Brick.");
    expect(renamed).not.toMatch(/Added|Removed|Changed/);
    // Renaming changes nothing the checks look at.
    expect(renamed).not.toMatch(/Checked what|Faults in/);
    const copied = await script([
      "import bpy",
      "brick = bpy.data.objects['Brick']",
      "copy = brick.copy()",
      "copy.location.x += 1",
      "bpy.context.scene.collection.objects.link(copy)",
      "brick.name = 'Stone'",
    ]);
    expect(copied).toContain("Renamed Brick to Stone.");
    expect(copied).toMatch(/^Added Brick\.001 \(/m);
    expect(copied).not.toMatch(/Removed|Changed Stone/);
    const pulled = await script([
      "import bpy",
      "wing = bpy.data.objects['Wing']",
      "wing.name = 'Flap'",
      "for v in wing.data.vertices:",
      "    if v.co.x > 0:",
      "        v.co.x += 0.02",
      "wing.data.update()",
    ]);
    expect(pulled).toContain("Renamed Wing to Flap.");
    expect(pulled).toMatch(/^Changed Flap \(/m);
    expect(pulled).toMatch(
      /^Symmetry lost: Flap was the same on both sides of its own x = 0 and no longer is: /m,
    );
  }, 120_000);

  it("finds flat faces smooth shading draws curved and four-sided faces folded, and says neither where shading keeps flat faces flat", async () => {
    await done("blender_open_scene", { path: "shading.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Soft",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [0, 0, 0.05],
        },
        {
          name: "Crisp",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [0.5, 0, 0.05],
        },
      ],
    });
    const soft = await done("blender_shape_objects", {
      object: "Soft",
      operations: [{ kind: "smooth", shading: "smooth" }],
    });
    expect(faultsOf(soft, "Soft"), soft).toMatch(
      /6 flat areas shade as if curved, smooth shading leaning its corners up to 55° off a flat area of 100 cm² at \([-\d., ]+ mm\): keep its edges sharp with a smooth step by angle, or weight its normals by face area/,
    );
    const crisp = await done("blender_shape_objects", {
      object: "Crisp",
      operations: [{ kind: "smooth" }],
    });
    expect(crisp).toContain(CLEAN);
    const folded = await script([
      ...meshMaker,
      "def sheet(b):",
      "    p = [b.verts.new(c) for c in ((0, 0, 0), (0.1, 0, 0), (0.1, 0.1, 0.06), (0, 0.1, 0))]",
      "    b.faces.new(p)",
      "made('Twisted', sheet, (1, 0, 0))",
    ]);
    expect(faultsOf(folded, "Twisted")).toMatch(
      /1 face of four sides folds more than 20° across both diagonals, up to 40° at \([-\d., ]+ m\), so it shades and splits into triangles unevenly/,
    );
  }, 120_000);

  it("counts the faces of each shape a shaping step or script changed by their sides, with where", async () => {
    await done("blender_open_scene", { path: "sides.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        {
          name: "Cage",
          kind: "box",
          size: [0.2, 0.2, 0.2],
          location: [0, 0, 0.1],
        },
      ],
    });
    const subdivided = await done("blender_shape_objects", {
      object: "Cage",
      operations: [{ kind: "subdivision", levels: 1 }],
    });
    expect(subdivided).toContain(
      "Faces by their sides: Cage: 24 quads, no triangles or faces of more than four sides.",
    );
    const cone = await script([
      ...meshMaker,
      "def spike(b):",
      "    bmesh.ops.create_cone(b, cap_ends=True, segments=8, radius1=0.05, radius2=0, depth=0.1)",
      "made('Spike', spike, (1, 0, 0.05))",
    ]);
    expect(cone).toMatch(
      /Faces by their sides: Spike: 0 quads, 8 triangles, as at \([-\d., ]+ m{0,2}\), 1 of more than four sides, the largest of 8 at \([-\d., ]+ m{0,2}\)\./,
    );
    const added = await done("blender_add_objects", {
      objects: [
        {
          name: "Other",
          kind: "box",
          size: [0.1, 0.1, 0.1],
          location: [2, 0, 0.05],
        },
      ],
    });
    expect(added).not.toContain("Faces by their sides");
  }, 120_000);
});
