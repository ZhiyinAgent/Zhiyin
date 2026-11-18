/**
 * The studio's measures against a real Blender: what instances place, what a
 * model file keeps of a material, the colours a render shows, the render
 * settings a picture follows, what floats, and a simulation's frames.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
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

/** The nodes a .glb file holds, from its JSON. */
async function glbNodes(path: string): Promise<{ mesh?: number }[]> {
  const file = await readFile(path);
  const length = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + length).toString("utf8")) as {
    nodes?: { mesh?: number }[];
  };
  return json.nodes ?? [];
}

/** Python that adds a mesh object built by bmesh, for a script to use. */
const meshMaker = [
  "import bmesh, bpy, mathutils",
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
  "def cube(size):",
  "    return lambda b: bmesh.ops.create_cube(b, size=size)",
];

describe.runIf(blender)("a real Blender's measures", () => {
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
  const script = async (lines: string[]) => {
    const ran = await call("blender_run_script", { code: lines.join("\n") });
    expect(ran.isError, ran.said).toBeUndefined();
    return ran.said;
  };
  const line = async (name: string) =>
    (await call("blender_describe_scene", { objects: [name] })).said
      .split("\n")
      .find((l) => l.startsWith(`- ${name}:`)) ?? "";

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-measures-");
    workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: containedSessionLaunch(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("measures"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("measures"),
    });
  });

  afterAll(async () => {
    await scenes.forget("measures");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("measures what geometry nodes and collections place as instances, naming each by its source and its instancer", async () => {
    await call("blender_open_scene", { path: "scatter.blend", create: true });
    // A closed box with nine balls inside it, placed by geometry nodes from
    // a hidden ball; three pegs, two on the floor and one in the air; and a
    // collection's block placed by an empty, half in the box.
    await script([
      ...meshMaker,
      "box = made('Box', cube(1), (0, 0, 0.5))",
      "ball = made('Ball', lambda b: bmesh.ops.create_uvsphere(b, u_segments=16, v_segments=8, radius=0.05), (10, 10, 10))",
      "ball.hide_render = True",
      "def scatter(name, points, at):",
      "    obj = made(name, lambda b: [b.verts.new(p) for p in points], at)",
      "    tree = bpy.data.node_groups.new(name, 'GeometryNodeTree')",
      "    tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')",
      "    tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')",
      "    given, out = tree.nodes.new('NodeGroupInput'), tree.nodes.new('NodeGroupOutput')",
      "    info = tree.nodes.new('GeometryNodeObjectInfo')",
      "    info.inputs['Object'].default_value = ball",
      "    info.inputs['As Instance'].default_value = True",
      "    placed = tree.nodes.new('GeometryNodeInstanceOnPoints')",
      "    tree.links.new(given.outputs[0], placed.inputs['Points'])",
      "    tree.links.new(info.outputs['Geometry'], placed.inputs['Instance'])",
      "    tree.links.new(placed.outputs['Instances'], out.inputs[0])",
      "    obj.modifiers.new('Scatter', 'NODES').node_group = tree",
      "scatter('Scatter', [(x, y, 0) for x in (-0.3, 0, 0.3) for y in (-0.3, 0, 0.3)], (0, 0, 0.5))",
      "scatter('Pegs', [(0, 0, 0.05), (0.2, 0, 0.05), (0.4, 0, 0.5)], (2, 0, 0))",
      "kit = bpy.data.collections.new('Kit')",
      "block = made('Block', cube(0.4))",
      "s.collection.objects.unlink(block)",
      "kit.objects.link(block)",
      "crate = bpy.data.objects.new('Crate', None)",
      "crate.instance_type = 'COLLECTION'",
      "crate.instance_collection = kit",
      "crate.location = (0.6, 0, 0.5)",
      "s.collection.objects.link(crate)",
    ]);

    const scatter = await line("Scatter");
    const box = await line("Box");
    const crate = await line("Crate");
    const pegs = await line("Pegs");

    expect(scatter).toContain("from 450 mm to 550 mm high");
    expect(scatter).toContain("places 9 instances of Ball, 128 faces each");
    expect(scatter).toMatch(
      /9 of its instances go into Box, the deepest [\d.]+ mm/,
    );
    expect(box).toMatch(/goes [\d.]+ mm into Scatter's instances of Ball/);
    expect(box).toMatch(/goes [\d.]+ mm into Crate's instances of Block/);
    expect(crate).toContain("400 × 400 × 400 mm");
    expect(crate).toContain("from 300 mm to 700 mm high");
    expect(crate).toContain("places 1 instance of Block, 6 faces each");
    expect(crate).toMatch(/goes [\d.]+ mm into Box/);
    expect(pegs).toContain("from 0 mm to 550 mm high");
    expect(pegs).toContain("1 of its 3 pieces is held by nothing");

    // Framing fits the instances, as it fits any shape.
    const framed = await call("blender_set_camera", {
      frame: { objects: ["Scatter"], direction: "three-quarter" },
      resolution: [400, 300],
    });
    expect(framed.isError, framed.said).toBeUndefined();
    const seen = await script([
      "import bpy",
      "from bpy_extras.object_utils import world_to_camera_view",
      "s = bpy.context.scene",
      "p = []",
      "for i in bpy.context.evaluated_depsgraph_get().object_instances:",
      "    if i.is_instance and i.parent.original.name == 'Scatter':",
      "        p += [world_to_camera_view(s, s.camera, i.matrix_world @ v.co) for v in i.object.data.vertices]",
      "print('seen', min(q.x for q in p), max(q.x for q in p), min(q.y for q in p), max(q.y for q in p))",
    ]);
    const [left, right, bottom, top] = (/seen (.+)/.exec(seen)?.[1] ?? "")
      .split(" ")
      .map(Number) as [number, number, number, number];
    expect((left + right) / 2).toBeCloseTo(0.5, 2);
    expect((bottom + top) / 2).toBeCloseTo(0.5, 2);
    expect(Math.max(right - left, top - bottom)).toBeCloseTo(0.9, 2);

    // A .glb holds the balls the nodes place.
    const exported = await call("blender_export", {
      output: "scatter.glb",
      objects: ["Scatter"],
    });
    expect(exported.isError, exported.said).toBeUndefined();
    const nodes = await glbNodes(join(workspace, "scatter.glb"));
    expect(nodes.filter((n) => n.mesh !== undefined)).toHaveLength(9);

    // Set down by the shape it places.
    const rested = await call("blender_edit_objects", {
      edits: [{ object: "Crate", rest_on: "floor" }],
    });
    expect(rested.isError, rested.said).toBeUndefined();
    expect(rested.said).toContain("from 0 mm to 400 mm high");
  }, 180_000);

  it("measures the first thousand copies of a large scatter, and says so", async () => {
    await call("blender_open_scene", { path: "grass.blend", create: true });
    await script([
      ...meshMaker,
      "blade = made('Blade', cube(0.01), (10, 10, 10))",
      "blade.hide_render = True",
      "field = made('Field', lambda b: None)",
      "tree = bpy.data.node_groups.new('Field', 'GeometryNodeTree')",
      "tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')",
      "grid = tree.nodes.new('GeometryNodeMeshGrid')",
      "grid.inputs['Vertices X'].default_value = 40",
      "grid.inputs['Vertices Y'].default_value = 30",
      "info = tree.nodes.new('GeometryNodeObjectInfo')",
      "info.inputs['Object'].default_value = blade",
      "info.inputs['As Instance'].default_value = True",
      "placed = tree.nodes.new('GeometryNodeInstanceOnPoints')",
      "out = tree.nodes.new('NodeGroupOutput')",
      "tree.links.new(grid.outputs['Mesh'], placed.inputs['Points'])",
      "tree.links.new(info.outputs['Geometry'], placed.inputs['Instance'])",
      "tree.links.new(placed.outputs['Instances'], out.inputs[0])",
      "field.modifiers.new('Field', 'NODES').node_group = tree",
    ]);

    expect(await line("Field")).toContain(
      "places 1,200 instances of Blade, 6 faces each; the first 1,000 are measured",
    );
  }, 120_000);

  it("says which materials a .glb cannot hold, what the file gives them instead, and that baking keeps them", async () => {
    await call("blender_open_scene", { path: "finishes.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        {
          name: "Tile",
          kind: "cube",
          size: [0.2, 0.2, 0.02],
          location: [0, 0, 0.01],
        },
        {
          name: "Plank",
          kind: "cube",
          size: [1, 0.2, 0.03],
          location: [0, 1, 0.015],
        },
        {
          name: "Dice",
          kind: "cube",
          size: [0.1, 0.1, 0.1],
          location: [1, 0, 0.05],
        },
      ],
    });
    await call("blender_set_material", {
      objects: ["Tile"],
      material: { name: "Glaze", color: "#3366aa", roughness: 0.3 },
    });
    await call("blender_set_material", {
      objects: ["Plank"],
      material: { name: "Oak", color: "#c9a678", roughness: 0.6, wood: 0.5 },
    });
    await script([
      "import bpy",
      "m = bpy.data.materials.new('Speckled')",
      "m.use_nodes = True",
      "bsdf = m.node_tree.nodes['Principled BSDF']",
      "noise = m.node_tree.nodes.new('ShaderNodeTexNoise')",
      "m.node_tree.links.new(noise.outputs['Color'], bsdf.inputs['Base Color'])",
      "bpy.data.objects['Dice'].data.materials.append(m)",
    ]);

    const exported = await call("blender_export", { output: "finishes.glb" });

    expect(exported.isError, exported.said).toBeUndefined();
    expect(exported.said).toMatch(
      /Speckled's colour comes from nodes a \.glb cannot hold: the file gives it plain #ffffff instead/,
    );
    expect(exported.said).toMatch(/Oak's colour .*cannot hold/);
    expect(exported.said).toContain(
      "Exporting to a .glb with bake: true keeps",
    );
    expect(exported.said).not.toContain("Glaze");
  }, 120_000);

  it("reads the colours a render shows by the objects drawn flat, whatever the scene composites", async () => {
    await call("blender_open_scene", {
      path: "composited.blend",
      create: true,
    });
    await call("blender_add_objects", {
      objects: [
        { name: "Red", kind: "cube", size: [1, 1, 1], location: [0, 0, 0.5] },
      ],
    });
    await call("blender_set_material", {
      objects: ["Red"],
      material: { name: "Red", color: "#ff0000", roughness: 1 },
    });
    await call("blender_set_camera", {
      frame: { objects: ["Red"], direction: "front", margin: 0.3 },
      resolution: [160, 120],
    });
    // A compositor that inverts the picture's colours.
    await script([
      "import bpy",
      "s = bpy.context.scene",
      "tree = bpy.data.node_groups.new('Inverted', 'CompositorNodeTree')",
      "tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')",
      "layers = tree.nodes.new('CompositorNodeRLayers')",
      "invert = tree.nodes.new('CompositorNodeInvert')",
      "out = tree.nodes.new('NodeGroupOutput')",
      "tree.links.new(layers.outputs['Image'], invert.inputs['Color'])",
      "tree.links.new(invert.outputs[0], out.inputs[0])",
      "s.compositing_node_group = tree",
      "s.render.use_compositing = True",
    ]);

    const rendered = await call("blender_render", {
      output: "red.png",
      engine: "eevee",
      samples: 4,
    });

    expect(rendered.isError, rendered.said).toBeUndefined();
    expect(rendered.said).toMatch(/Colours in the picture.*Red #[0-9a-f]{6}/);
    expect(rendered.said).not.toContain("could not be read");
    const kept = await script([
      "import bpy",
      "print('compositing', bpy.context.scene.render.use_compositing)",
    ]);
    expect(kept).toContain("compositing True");
  }, 120_000);

  it("denoises as the scene asks, and says when path guiding goes unused on a graphics card", async () => {
    await call("blender_open_scene", { path: "settings.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "Block", kind: "cube", size: [1, 1, 1], location: [0, 0, 0.5] },
      ],
    });
    await call("blender_set_camera", {
      frame: { objects: ["Block"], direction: "three-quarter" },
      resolution: [64, 48],
    });
    await script([
      "import bpy",
      "c = bpy.context.scene.cycles",
      "c.use_denoising = False",
      "c.use_guiding = True",
    ]);

    const rendered = await call("blender_render", {
      output: "block.png",
      engine: "cycles",
      samples: 4,
    });

    expect(rendered.isError, rendered.said).toBeUndefined();
    const settings = await script([
      "import bpy",
      "print('denoising', bpy.context.scene.cycles.use_denoising)",
    ]);
    expect(settings).toContain("denoising False");
    if (rendered.said.includes("Cycles on the processor")) {
      expect(rendered.said).not.toContain("path guiding");
    } else {
      expect(rendered.said).toContain(
        "The scene asks for path guiding, which Cycles does only on the processor: this picture was drawn on",
      );
    }
  }, 120_000);

  it("says an object of one piece floats when it touches nothing and rests on nothing, but not one meant to hang", async () => {
    await call("blender_open_scene", { path: "hanging.blend", create: true });
    const added = await call("blender_add_objects", {
      objects: [
        { name: "Floor", kind: "plane", size: [6, 6], location: [0, 0, 0] },
        {
          name: "Chair",
          kind: "cube",
          size: [0.5, 0.5, 0.5],
          location: [-1, 0, 0.25],
        },
        {
          name: "Lamp",
          kind: "cube",
          size: [0.2, 0.2, 0.2],
          location: [1, 1, 2],
        },
        {
          name: "Shade",
          kind: "cube",
          size: [0.2, 0.2, 0.2],
          location: [-1, 0, 1.5],
          parent: "Chair",
        },
        {
          name: "Kite",
          kind: "cube",
          size: [0.2, 0.2, 0.2],
          location: [2, -1, 3],
        },
        {
          name: "Bird",
          kind: "cube",
          size: [0.2, 0.2, 0.2],
          location: [-2, -1, 3],
        },
      ],
    });
    expect(added.isError, added.said).toBeUndefined();
    const keyed = await call("blender_animate", {
      keys: [
        { object: "Bird", at: 0, location: [-2, -1, 3] },
        { object: "Bird", at: 1, location: [-2, 1, 3] },
      ],
    });
    expect(keyed.isError, keyed.said).toBeUndefined();
    await script([
      "import bpy",
      "kept = bpy.data.objects['Kite'].constraints.new('CHILD_OF')",
      "kept.target = bpy.data.objects['Chair']",
      "kept.set_inverse_pending = True",
    ]);

    expect(await line("Lamp")).toContain(
      "held by nothing: it touches no other shape and its bottom is 1.9 m above the floor",
    );
    // The chair stands on the floor; the shade it holds is still counted
    // among the chair's pieces, as any part attached to an object is.
    expect(await line("Chair")).toContain(
      "1 of its 2 pieces is held by nothing",
    );
    for (const name of ["Floor", "Chair", "Shade", "Kite", "Bird"])
      expect(await line(name), name).not.toContain("held by nothing:");

    // A scene standing above z = 0 has its floor at its lowest bottom.
    await call("blender_open_scene", { path: "aloft.blend", create: true });
    await call("blender_add_objects", {
      objects: [
        { name: "Low", kind: "cube", size: [1, 1, 1], location: [0, 0, 5.5] },
        { name: "High", kind: "cube", size: [1, 1, 1], location: [3, 0, 7.5] },
      ],
    });
    expect(await line("Low")).not.toContain("held by nothing");
    expect(await line("High")).toContain(
      "its bottom is 2 m above the floor at 5 m",
    );
  }, 120_000);

  it("steps a simulation's frames from the start, so a falling box is drawn where it lands", async () => {
    await call("blender_open_scene", { path: "falling.blend", create: true });
    await script([
      ...meshMaker,
      "crate = made('Crate', cube(0.2), (0, 0, 2))",
      "ground = made('Ground', lambda b: bmesh.ops.create_grid(b, x_segments=1, y_segments=1, size=2))",
      "with bpy.context.temp_override(scene=s):",
      "    bpy.ops.rigidbody.world_add()",
      "s.rigidbody_world.collection = bpy.data.collections.new('Simulated')",
      "for obj, kind in ((crate, 'ACTIVE'), (ground, 'PASSIVE')):",
      "    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], scene=s):",
      "        bpy.ops.rigidbody.object_add(type=kind)",
      "    obj.rigid_body.collision_shape = 'BOX'",
      "    obj.rigid_body.friction = 1",
      "s.frame_end = 72",
    ]);

    const sheet = await call("blender_frame_sheet", {
      every_ms: 1250,
      count: 3,
      objects: ["Crate"],
      view: "overview",
      engine: "solid",
    });

    expect(sheet.isError, sheet.said).toBeUndefined();
    /** How high the top of what a line describes is, in metres. */
    const topOf = (said: string) => {
      const top = /to ([\d.]+) (mm|m) high/.exec(said);
      expect(top, said).not.toBeNull();
      return Number(top?.[1]) / (top?.[2] === "mm" ? 1000 : 1);
    };
    const last =
      sheet.said.split("\n").find((l) => l.startsWith("2.5 s:")) ?? "";
    expect(topOf(last), last).toBeLessThan(0.35);

    // Close-ups at the same moment see it there too.
    const close = await call("blender_close_ups", {
      objects: ["Crate"],
      time: 2.5,
    });
    expect(close.isError, close.said).toBeUndefined();
    const crate =
      close.said.split("\n").find((l) => l.startsWith("- Crate:")) ?? "";
    expect(topOf(crate), crate).toBeLessThan(0.35);
  }, 180_000);

  it("says what holds each object up, what floats farthest first, what many go into together, and the scene's budget", async () => {
    await call("blender_open_scene", { path: "dressed.blend", create: true });
    const box = (name: string, size: number[], location: number[]) => ({
      name,
      kind: "box",
      size,
      location,
    });
    const added = await call("blender_add_objects", {
      objects: [
        box("Floor", [6, 6, 0.1], [0, 0, -0.05]),
        box("Table", [1, 1, 0.75], [0, 0, 0.375]),
        box("Cup", [0.08, 0.08, 0.1], [0, 0, 0.8]),
        box("Lamp", [0.2, 0.2, 0.2], [-2, 0, 2.1]),
        box("Ball", [0.2, 0.2, 0.2], [-2, 2, 0.6]),
        { ...box("Bird", [0.2, 0.2, 0.2], [2, 2, 3.1]), flying: true },
        box("Log", [2, 0.3, 0.3], [0, -2, 0.15]),
        ...[0, 1, 2, 3, 4, 5].map((i) =>
          box(`Rock ${i}`, [0.1, 0.1, 0.1], [-0.75 + i * 0.3, -1.85, 0.05]),
        ),
      ],
    });
    expect(added.isError, added.said).toBeUndefined();
    await script([
      ...meshMaker,
      "pebble = made('Pebble', cube(0.04), (10, 10, 10))",
      "pebble.hide_render = True",
      "pile = made('Pile', lambda b: [b.verts.new(p) for p in ((0.3, 0.3, 0.74), (-0.3, 0.3, 0.74), (0.3, -0.3, 0.74), (3, 3, 0.02))])",
      "tree = bpy.data.node_groups.new('Pile', 'GeometryNodeTree')",
      "tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')",
      "tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')",
      "given, out = tree.nodes.new('NodeGroupInput'), tree.nodes.new('NodeGroupOutput')",
      "info = tree.nodes.new('GeometryNodeObjectInfo')",
      "info.inputs['Object'].default_value = pebble",
      "info.inputs['As Instance'].default_value = True",
      "placed = tree.nodes.new('GeometryNodeInstanceOnPoints')",
      "tree.links.new(given.outputs[0], placed.inputs['Points'])",
      "tree.links.new(info.outputs['Geometry'], placed.inputs['Instance'])",
      "tree.links.new(placed.outputs['Instances'], out.inputs[0])",
      "pile.modifiers.new('Pile', 'NODES').node_group = tree",
      "grain = bpy.data.images.new('Grain', 256, 256)",
      "paint = bpy.data.materials.new('Paint')",
      "paint.use_nodes = True",
      "paint.node_tree.nodes.new('ShaderNodeTexImage').image = grain",
      "bpy.data.objects['Table'].data.materials.append(paint)",
    ]);

    const described = (await call("blender_describe_scene", {})).said;
    const of = (name: string) =>
      described.split("\n").find((l) => l.startsWith(`- ${name}:`)) ?? "";

    expect(of("Cup")).toContain("rests on Table");
    expect(of("Table")).toContain("rests on Floor");
    expect(of("Bird")).toContain("is flying, 3 m above Floor");
    expect(of("Bird")).not.toContain("held by nothing");
    // Three of the pile's four pebbles reach from 720 mm to 760 mm, 30 mm
    // into the table's top; the fourth rests on the floor.
    expect(of("Pile")).toContain(
      "3 of its instances go into Table, the deepest 30 mm",
    );
    // Each rock goes 50 mm into the log; the log and the rocks name none of
    // them one by one, and a line says them together.
    expect(of("Rock 0")).not.toContain("goes 50");
    expect(of("Rock 0")).toContain("rests on Floor, set into Log");
    expect(of("Floor")).toContain("rests on the floor");
    expect(of("Floor")).not.toContain("Table");
    expect(of("Log")).not.toContain("goes 50");
    expect(described).toMatch(
      /- 6 objects go into Log: Rock ×6, the deepest Rock 0 by 50(\.\d+)? mm\./,
    );
    expect(described).toContain(
      "Touching nothing, the farthest above what is under it first: Bird is flying, 3 m above Floor; Lamp touches nothing, 2 m above Floor; Ball touches nothing, 500 mm above Floor.",
    );
    // 13 boxes of 6 faces and four pebbles of 6 drawn; held, one pebble's
    // mesh, the boxes' and the pile's own points; a 256 px picture of RGBA bytes.
    expect(described).toContain(
      "Scene budget: 102 faces drawn, 84 held in 15 meshes kept once each; 4 instances; pictures 0.25 MB in memory as loaded (1 picture). Most faces drawn: Pile (24 faces, 4 instances), Floor (6 faces), Table (6 faces)",
    );
  }, 180_000);
});
