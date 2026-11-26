/**
 * A model's scripts and change calls against a real Blender: what would end
 * a Blender without a window is refused before it runs, what does nothing
 * without one is said, and each answer tells what the change measurably did.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
 */

import { mkdir, stat } from "node:fs/promises";
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
  content: { type: string; text?: string }[];
};

describe.runIf(blender)("a real Blender, on a model's calls", () => {
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
  const script = (code: string) =>
    call("blender_run_script", { code: code.trim() });
  /** A box of the size given in metres, standing on the floor at x. */
  const box = (name: string, size: readonly number[], x: number) =>
    call("blender_add_objects", {
      objects: [
        {
          name,
          kind: "cube",
          size,
          location: [x, 0, size[2]! / 2],
        },
      ],
    });

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-calls-");
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
    tools = sceneAutomation(scenes.scene("calls"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("calls"),
    });
    const opened = await call("blender_open_scene", {
      path: "calls.blend",
      create: true,
    });
    expect(opened.isError, opened.said).toBeUndefined();
  }, 180_000);

  afterAll(async () => {
    await scenes.forget("calls");
    await scenes.closeAll();
    await folders.removeAll();
  });

  describe("a script", () => {
    it("is refused an operator that ends a Blender without a window, with the way round it, and the session carries on", async () => {
      await box("Block", [0.1, 0.1, 0.1], 0);
      const crashers = {
        "bpy.ops.mesh.loopcut_slide": [
          "bpy.context.view_layer.objects.active = bpy.data.objects['Block']",
          "bpy.ops.object.mode_set(mode='EDIT')",
          "bpy.ops.mesh.loopcut_slide(MESH_OT_loopcut={'number_cuts': 2, 'object_index': 0, 'edge_index': 0}, TRANSFORM_OT_edge_slide={'value': 0.0})",
        ],
        "bpy.ops.sculpt.mesh_filter": [
          "bpy.context.view_layer.objects.active = bpy.data.objects['Block']",
          "bpy.ops.object.mode_set(mode='SCULPT')",
          "bpy.ops.sculpt.mesh_filter(type='INFLATE', strength=0.5)",
        ],
        "bpy.ops.paint.mask_flood_fill": [
          "bpy.context.view_layer.objects.active = bpy.data.objects['Block']",
          "bpy.ops.object.mode_set(mode='SCULPT')",
          "bpy.ops.paint.mask_flood_fill(mode='VALUE', value=1.0)",
        ],
        "bpy.ops.uv.stitch": [
          "bpy.context.view_layer.objects.active = bpy.data.objects['Block']",
          "bpy.ops.object.mode_set(mode='EDIT')",
          "bpy.ops.mesh.select_all(action='SELECT')",
          "bpy.ops.uv.stitch()",
        ],
        "bpy.ops.transform.translate": [
          "block = bpy.data.objects['Block']",
          "bpy.context.view_layer.objects.active = block",
          "block.select_set(True)",
          "bpy.ops.transform.translate(value=(0, 0, -0.05), snap=True, snap_elements={'FACE_NEAREST'})",
        ],
      };

      const answers: Record<string, { isError?: boolean; said: string }> = {};
      for (const [operator, lines] of Object.entries(crashers))
        answers[operator] = await script(lines.join("\n"));
      const after = await script(
        "print(len(bpy.data.objects['Block'].data.vertices), bpy.context.mode)",
      );

      expect(answers["bpy.ops.mesh.loopcut_slide"]?.said).toContain(
        "bpy.ops.mesh.loopcut_slide ends this Blender, which runs without a window, so it was not run. Instead, cut loops with bmesh.ops.subdivide_edgering",
      );
      expect(answers["bpy.ops.sculpt.mesh_filter"]?.said).toContain(
        "bpy.ops.sculpt.mesh_filter ends this Blender, which runs without a window, so it was not run. Instead, filter the mesh with zhiyin.sculpt_filter(obj, kind)",
      );
      expect(answers["bpy.ops.paint.mask_flood_fill"]?.said).toContain(
        "make a sculpt mask as a vertex group with zhiyin.sculpt_mask(picked, name)",
      );
      expect(answers["bpy.ops.uv.stitch"]?.said).toContain(
        "mesh.uv_layers.active.data[loop].uv",
      );
      expect(answers["bpy.ops.transform.translate"]?.said).toContain(
        "snapping does nothing in a Blender without a window",
      );
      for (const answer of Object.values(answers))
        expect(answer.isError, answer.said).toBe(true);
      // Each script's own Blender gave the guard's words rather than ending,
      // and the scene the next script opens is the one saved before them.
      expect(after.isError, after.said).toBeUndefined();
      expect(after.said).toContain("8 OBJECT");
    }, 180_000);

    it("is told that snapping does nothing without a window, and the object stays where it was", async () => {
      await box("Peg", [0.02, 0.02, 0.02], 0.5);

      const snapped = await script(`
peg = bpy.data.objects['Peg']
bpy.context.view_layer.objects.active = peg
peg.select_set(True)
bpy.ops.transform.translate(value=(0.013, 0, 0), snap=True, snap_elements={'INCREMENT'})
`);
      const where = await script(
        "print(round(bpy.data.objects['Peg'].location.x, 4))",
      );

      expect(snapped.isError).toBe(true);
      expect(snapped.said).toContain(
        "bpy.ops.transform.translate: snapping does nothing in a Blender without a window: it moves by the plain value given and ignores the snap",
      );
      expect(snapped.said).toContain("Place by measured positions instead");
      expect(where.said).toContain("0.5");
    }, 120_000);

    it("that sets a picture's pixels and keeps them nowhere is told the scene file keeps the picture blank", async () => {
      const made = await script(`
image = bpy.data.images.new('Painted', 4, 4)
image.pixels[:] = [1.0, 0.0, 0.0, 1.0] * 16
`);
      const after = await script(
        "image = bpy.data.images.get('Painted')\nprint('red', image is not None and image.pixels[0] == 1.0)",
      );

      expect(made.isError, made.said).toBeUndefined();
      expect(made.said).toContain(
        "The picture Painted holds pixels the script set that nothing keeps: it is neither packed nor saved, so the scene file keeps it blank. Pack it with image.pack() or save it with image.save().",
      );
      // The next script opens the scene as the file holds it.
      expect(after.said).not.toContain("red True");
    }, 120_000);

    it("that only reads leaves the scene file as it was; one that changes the scene saves it", async () => {
      await box("Read", [0.1, 0.1, 0.1], 6);
      const scene = join(workspace, "calls.blend");
      const saved = (await stat(scene)).mtimeMs;
      const read = await script(
        "print('high', round(bpy.data.objects['Read'].dimensions.z, 3))",
      );
      const afterReading = (await stat(scene)).mtimeMs;
      const moved = await script("bpy.data.objects['Read'].location.x += 0.05");
      const afterMoving = (await stat(scene)).mtimeMs;

      expect(read.isError, read.said).toBeUndefined();
      expect(read.said).toContain("high 0.1");
      expect(afterReading).toBe(saved);
      expect(moved.isError, moved.said).toBeUndefined();
      expect(moved.said).toContain("Changed Read");
      expect(afterMoving).toBeGreaterThan(saved);
    }, 120_000);

    it("finds the data an earlier script made and nothing used yet, until the scene is opened again; data used and let go is gone", async () => {
      await box("Dressed", [0.1, 0.1, 0.1], 7);
      const made = await script(`
bpy.data.materials.new('Red')
bpy.data.materials.new('Spare')
worn = bpy.data.materials.new('Worn')
bpy.data.objects['Dressed'].data.materials.append(worn)
`);
      const letGo = await script(
        "bpy.data.objects['Dressed'].data.materials.clear()",
      );
      // A change of the session's own saves the scene between the scripts.
      await box("Between", [0.1, 0.1, 0.1], 8);
      const assigned = await script(`
bpy.data.objects['Dressed'].data.materials.append(bpy.data.materials['Red'])
print('spare', 'Spare' in bpy.data.materials, 'worn', 'Worn' in bpy.data.materials)
`);
      const reopened = await call("blender_open_scene", {
        path: "calls.blend",
      });
      const after = await script(`
print('wears', bpy.data.objects['Dressed'].active_material.name, 'spare', 'Spare' in bpy.data.materials)
`);

      for (const answer of [made, letGo, assigned, reopened, after])
        expect(answer.isError, answer.said).toBeUndefined();
      expect(assigned.said).toContain("spare True worn False");
      expect(after.said).toContain("wears Red spare False");
    }, 120_000);

    it("that leaves data only a setting refers to, which Blender counts no user for, finds it in the next script; data nothing refers to any more is gone", async () => {
      const made = await script(`
bpy.ops.mesh.primitive_cube_add(size=0.2, location=(4, 0, 0.1))
cut = bpy.context.active_object
cut.name = 'Cut'
cutter = bpy.data.objects.new('Cutter', bpy.data.meshes.new('Cutter'))
bpy.context.scene.collection.objects.link(cutter)
cut.modifiers.new('Cut', 'BOOLEAN').object = cutter
cut.data.materials.append(bpy.data.materials.new('Loose'))
`);
      // The next script takes the cutter out of the scene, so only the boolean refers to it.
      const unlinked = await script(`
cut = bpy.data.objects['Cut']
bpy.context.scene.collection.objects.unlink(bpy.data.objects['Cutter'])
cut.data.materials.clear()
`);
      // A change of the session's own saves the scene once more before the next script opens it.
      await box("Beside", [0.1, 0.1, 0.1], 5);
      const after = await script(`
cutter = bpy.data.objects['Cut'].modifiers['Cut'].object
print('cutter', cutter and cutter.name, 'fake user', cutter and cutter.use_fake_user, 'loose', 'Loose' in bpy.data.materials)
`);

      expect(made.isError, made.said).toBeUndefined();
      expect(unlinked.isError, unlinked.said).toBeUndefined();
      expect(after.isError, after.said).toBeUndefined();
      expect(after.said).toContain("cutter Cutter fake user False loose False");
    }, 120_000);

    it("that reads a geometry-node input as before Blender 5.2 is given the 5.2 form for that input, by its name", async () => {
      const failed = await script(`
bpy.ops.mesh.primitive_cube_add(size=0.1, location=(2, 0, 0.05))
obj = bpy.context.active_object
obj.name = 'Bumpy'
group = bpy.data.node_groups.new('Bump', 'GeometryNodeTree')
group.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
group.interface.new_socket('Height', in_out='INPUT', socket_type='NodeSocketFloat')
group.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
into, out = group.nodes.new('NodeGroupInput'), group.nodes.new('NodeGroupOutput')
group.links.new(into.outputs[0], out.inputs[0])
mod = obj.modifiers.new('Bump', 'NODES')
mod.node_group = group
mod["Socket_1"] = 0.02
`);

      expect(failed.isError).toBe(true);
      expect(failed.said).toContain(
        "TypeError: bpy_struct[key] = val: id properties not supported for this type",
      );
      expect(failed.said).toContain(
        'In Blender 5.2 a geometry-nodes modifier\'s inputs are not read or set by mod["Socket_1"]: Socket_1 is the input Height of Bump, set as mod.properties.inputs.Socket_1.value = …',
      );
    }, 120_000);
  });

  describe("a driver", () => {
    it("that needs Python, which this Blender does not run, is said with how to write it so it runs; one Blender works out itself is not", async () => {
      const made = await script(`
bpy.ops.mesh.primitive_cube_add(size=0.1, location=(3, 0, 0.05))
lift = bpy.context.active_object
lift.name = 'Lift'
python = lift.driver_add('location', 2).driver
python.type = 'SCRIPTED'
python.expression = 'my_lift(frame)'
simple = lift.driver_add('location', 1).driver
simple.type = 'SCRIPTED'
simple.expression = 'sin(frame) * 0.1'
`);
      const described = await call("blender_describe_scene", {
        objects: ["Lift"],
      });

      const said =
        "Lift's location z is driven by my_lift(frame), which needs Python, and this Blender runs no Python in a driver: it holds the value at 0.";
      expect(made.isError, made.said).toBeUndefined();
      expect(made.said).toContain(said);
      expect(made.said).toContain(
        "Write it as an expression Blender works out itself",
      );
      expect(made.said).not.toContain("sin(frame) * 0.1");
      expect(described.said).toContain(said);
    }, 120_000);
  });

  describe("a boolean", () => {
    it("that takes nothing away is an error that says the cutter does not reach the part, and the part keeps no cutter", async () => {
      await box("Plate", [0.2, 0.1, 0.01], 5);

      const missed = await call("blender_shape_objects", {
        object: "Plate",
        operations: [
          {
            kind: "boolean",
            cutter: {
              shape: "cylinder",
              diameter: 0.01,
              depth: 0.02,
              location: [5, 0, 0.1],
            },
          },
        ],
      });
      const described = await call("blender_describe_scene", {
        objects: ["Plate"],
      });

      expect(missed.isError).toBe(true);
      expect(missed.said).toContain("takes nothing away from Plate");
      expect(missed.said).toContain("does not reach Plate");
      expect(described.said).not.toContain("Plate cutter");
    }, 120_000);

    it("with an open shape takes nothing away, and the error says the cutter is not closed", async () => {
      await box("Slab", [0.2, 0.1, 0.01], 6);
      const sheet = await script(`
bpy.ops.mesh.primitive_plane_add(size=0.05, location=(6, 0, 0.005))
bpy.context.active_object.name = 'Sheet'
`);
      expect(sheet.isError, sheet.said).toBeUndefined();

      const open = await call("blender_shape_objects", {
        object: "Slab",
        operations: [{ kind: "boolean", with: "Sheet" }],
      });

      expect(open.isError, open.said).toBe(true);
      expect(open.said).toContain("takes nothing away from Slab");
      expect(open.said).toContain("Sheet is not closed");
    }, 120_000);

    it("says the hole it measured, not the cutter it was given", async () => {
      await box("Saucer", [0.1, 0.1, 0.01], 7);
      await box("Board", [0.1, 0.1, 0.01], 8);

      // A cutter 4 mm deep centred on the top, 10 mm up: 2 mm of it is in the part.
      const well = await call("blender_shape_objects", {
        object: "Saucer",
        operations: [
          {
            kind: "boolean",
            cutter: {
              shape: "cylinder",
              diameter: 0.09,
              depth: 0.004,
              location: [7, 0, 0.01],
            },
          },
        ],
      });
      const through = await call("blender_shape_objects", {
        object: "Board",
        operations: [
          {
            kind: "boolean",
            cutter: {
              shape: "cylinder",
              diameter: 0.01,
              depth: 0.05,
              location: [8, 0, 0.005],
            },
          },
        ],
      });

      expect(well.isError, well.said).toBeUndefined();
      expect(well.said).toContain(
        "Saucer: a round hole 90 mm across and 2 mm deep",
      );
      expect(well.said).not.toContain("4 mm deep");
      expect(through.isError, through.said).toBeUndefined();
      expect(through.said).toContain(
        "Board: a round hole 10 mm across, through its 10 mm",
      );
    }, 120_000);
  });

  describe("a material", () => {
    it("named as one that exists keeps every value the call does not give, and the answer says what changed", async () => {
      await box("Left", [0.05, 0.05, 0.05], 9);
      await box("Right", [0.05, 0.05, 0.05], 9.2);
      const first = await call("blender_set_material", {
        objects: ["Left", "Right"],
        material: { name: "Lacquer", color: "#c0392b", coat: 1, metallic: 0.3 },
      });
      expect(first.isError, first.said).toBeUndefined();

      const changed = await call("blender_set_material", {
        objects: ["Left"],
        material: { name: "Lacquer", roughness: 0.2 },
      });
      const described = await call("blender_describe_scene", {
        objects: ["Right"],
      });

      expect(changed.isError, changed.said).toBeUndefined();
      expect(changed.said).toContain("Lacquer changed: roughness 0.5 to 0.2.");
      expect(changed.said).toContain(
        "Material Lacquer (#c0392b, metallic 0.3, roughness 0.2, coat 1) on Left.",
      );
      expect(described.said).toContain(
        "Lacquer (#c0392b, roughness 0.2, metallic 0.3, coat 1)",
      );
    }, 120_000);

    it("keeps its finish when a call gives only wear, and a finish given brings its own colour", async () => {
      await box("Casting", [0.05, 0.05, 0.05], 9.4);
      await call("blender_set_material", {
        objects: ["Casting"],
        material: { name: "Cast", finish: "cast-iron", color: "#335533" },
      });

      const worn = await call("blender_set_material", {
        objects: ["Casting"],
        material: { name: "Cast", wear: 0.4 },
      });
      const refinished = await call("blender_set_material", {
        objects: ["Casting"],
        material: { name: "Cast", finish: "cast-aluminium" },
      });

      expect(worn.isError, worn.said).toBeUndefined();
      expect(worn.said).toContain("cast-iron finish");
      expect(worn.said).toContain("#335533");
      expect(worn.said).toContain("Cast changed: wear 0 to 0.4.");
      expect(refinished.isError, refinished.said).toBeUndefined();
      expect(refinished.said).toContain(
        "#b4b6b9 (cast-aluminium's own colour)",
      );
      expect(refinished.said).toContain("wear 0.4 on its edges and corners");
      expect(refinished.said).toContain(
        "Cast changed: finish cast-iron to cast-aluminium; colour #335533 to cast-aluminium's own",
      );
    }, 120_000);

    it("made by other means keeps its own shader nodes when a call gives values its shader takes", async () => {
      const made = await script(`
bpy.ops.mesh.primitive_cube_add(size=0.05, location=(9.6, 0, 0.025))
cube = bpy.context.active_object
cube.name = 'Imported'
material = bpy.data.materials.new('Brought')
material.use_nodes = True
nodes = material.node_tree.nodes
shader = nodes['Principled BSDF']
rgb = nodes.new('ShaderNodeRGB')
material.node_tree.links.new(rgb.outputs[0], shader.inputs['Base Color'])
cube.data.materials.append(material)
`);
      expect(made.isError, made.said).toBeUndefined();

      const patched = await call("blender_set_material", {
        objects: ["Imported"],
        material: { name: "Brought", roughness: 0.3 },
      });

      expect(patched.isError, patched.said).toBeUndefined();
      expect(patched.said).toContain(
        "Material Brought (colour from nodes, roughness 0.3) on Imported. Brought changed: roughness 0.5 to 0.3. Its own shader nodes stay.",
      );
    }, 120_000);
  });

  describe("a light", () => {
    it("is round or square as asked, and says so", async () => {
      const lit = await call("blender_set_lighting", {
        lights: [
          {
            name: "Softbox",
            kind: "area",
            location: [0, -2, 2],
            size: [0.8, 0.8],
            shape: "disk",
          },
        ],
      });
      const squared = await call("blender_set_lighting", {
        lights: [{ name: "Softbox", shape: "square" }],
      });

      expect(lit.isError, lit.said).toBeUndefined();
      expect(lit.said).toContain(
        "Softbox (area light, 100 W, 800 mm across, round)",
      );
      expect(squared.said).toContain(
        "Softbox (area light, 100 W, 800 mm across, square)",
      );
    }, 120_000);
  });

  describe("a session limit", () => {
    it("is named with the way to work within it when a call reaches past it", async () => {
      await box("Crank", [0.05, 0.05, 0.05], 10);
      await box("Piston", [0.05, 0.05, 0.05], 10.2);
      const camera = await call("blender_set_camera", {
        frame: { direction: "three-quarter" },
      });
      expect(camera.isError, camera.said).toBeUndefined();

      const timeline = await call("blender_animate", { duration: 601 });
      const video = await call("blender_render_video", {
        output: "long.mp4",
        start: 0,
        end: 301,
      });
      const formula = await call("blender_animate", {
        follow: [
          {
            object: "Piston",
            value: "place",
            axis: "z",
            from: { object: "Crank", value: "turn", axis: "z" },
            formula: `v * ${"1".repeat(500)}`,
          },
        ],
      });

      expect(timeline.isError).toBe(true);
      expect(timeline.said).toContain(
        "duration is at most 600 s, the longest a timeline runs",
      );
      expect(video.isError).toBe(true);
      expect(video.said).toContain(
        "A video lasts at most 300 s, and this one would last 301 s. Render it in parts of at most 300 s, each with its own start and end, such as 0 to 300 s and 300 to 301 s.",
      );
      expect(formula.isError).toBe(true);
      expect(formula.said).toContain(
        "A formula is at most 500 characters, and this one has 504.",
      );
    }, 120_000);
  });

  describe("Blender's own modelling, which the typed steps do not give", () => {
    it("runs in a script: the screw, skin and simple deform modifiers, a spin and a curve made a mesh", async () => {
      const made = await script(`
import bmesh, math
from mathutils import Matrix

def line(name, points):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [(i, i + 1) for i in range(len(points) - 1)], [])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

def evaluated(obj):
    graph = bpy.context.evaluated_depsgraph_get()
    mesh = obj.evaluated_get(graph).to_mesh()
    zs = [v.co.z for v in mesh.vertices]
    found = (len(mesh.vertices), len(mesh.polygons), round(max(zs) - min(zs), 3))
    obj.evaluated_get(graph).to_mesh_clear()
    return found

coil = line("Coil", [(0.05, 0, 0), (0.06, 0, 0)])
screw = coil.modifiers.new("Screw", "SCREW")
screw.screw_offset = 0.02
screw.iterations = 3
print("screw", *evaluated(coil))

frame = line("Frame", [(0, 0, 0), (0, 0, 0.3), (0.2, 0, 0.3)])
frame.modifiers.new("Skin", "SKIN")
print("skin", *evaluated(frame))

bar = bpy.data.objects.new("Bar", bpy.data.meshes.new("Bar"))
bpy.context.collection.objects.link(bar)
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((0.04, 0.04, 0.4, 1)))
bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.1], cuts=8)
bm.to_mesh(bar.data)
bm.free()
bend = bar.modifiers.new("Bend", "SIMPLE_DEFORM")
bend.deform_method = "BEND"
bend.angle = math.radians(180)
bend.deform_axis = "X"
print("bend", *evaluated(bar))

ring = bpy.data.objects.new("Ring", bpy.data.meshes.new("Ring"))
bpy.context.collection.objects.link(ring)
bm = bmesh.new()
a, b = bm.verts.new((0.03, 0, 0)), bm.verts.new((0.03, 0, 0.01))
bm.edges.new((a, b))
bmesh.ops.spin(bm, geom=list(bm.verts) + list(bm.edges), axis=(0, 0, 1), cent=(0, 0, 0), angle=math.radians(360), steps=24, use_duplicate=False)
bm.to_mesh(ring.data)
bm.free()
print("spin", len(ring.data.vertices), len(ring.data.polygons))

curve = bpy.data.curves.new("Rail", "CURVE")
curve.dimensions = "3D"
curve.bevel_depth = 0.005
spline = curve.splines.new("BEZIER")
spline.bezier_points.add(1)
spline.bezier_points[0].co = (0, 0, 0)
spline.bezier_points[1].co = (0.2, 0, 0.1)
for point in spline.bezier_points:
    point.handle_left_type = point.handle_right_type = "AUTO"
rail = bpy.data.objects.new("Rail", curve)
bpy.context.collection.objects.link(rail)
bpy.ops.object.select_all(action="DESELECT")
rail.select_set(True)
bpy.context.view_layer.objects.active = rail
bpy.ops.object.convert(target="MESH")
rail = bpy.data.objects["Rail"]
print("convert", rail.type, len(rail.data.vertices) > 0)
`);

      expect(made.isError, made.said).toBeUndefined();
      const line = (name: string) =>
        made.said
          .split("\n")
          .find((l) => l.startsWith(`${name} `))
          ?.split(" ")
          .slice(1);
      // Three turns of 2 cm each make a coil 6 cm high from a flat line.
      const screw = line("screw")!;
      expect(Number(screw[1])).toBeGreaterThan(0);
      expect(Number(screw[2])).toBeCloseTo(0.06, 2);
      // A skin turns three points into a closed tube round them.
      expect(Number(line("skin")![1])).toBeGreaterThan(0);
      // Bent through a half circle, a 40 cm bar spans about 2 × 40/π ≈ 25 cm,
      // plus its 4 cm thickness.
      expect(Number(line("bend")![2])).toBeLessThan(0.32);
      // A spun edge makes a band of faces all the way round.
      expect(Number(line("spin")![1])).toBe(24);
      expect(line("convert")).toEqual(["MESH", "True"]);
    }, 120_000);
  });
});
