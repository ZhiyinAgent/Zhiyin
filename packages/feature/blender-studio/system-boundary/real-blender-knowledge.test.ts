/**
 * The 3D studio's knowledge against a real Blender 5.2: its API read from
 * the installed Blender and kept, and each API change the studio answers a
 * failed script with, checked both ways: the old form raises the error the
 * change is matched by, and the form given instead runs.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-knowledge.test.ts
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
  type LaunchSession,
} from "../src/index.js";
import { apiBreaks } from "../src/api-breaks.js";
import { quietChanges } from "../src/quiet-changes.js";
import { writtenPages } from "../src/written-pages.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

/** A Blender API change, as a script meets it: what it sets up, each old form, and the new one. */
type Case = {
  readonly setup?: string;
  readonly wrong: readonly string[];
  readonly right: string;
};

const cube = `
import math, mathutils
from bpy_extras import anim_utils
obj = bpy.data.objects.get('Probe')
if obj is None:
    bpy.ops.mesh.primitive_cube_add(size=0.1, location=(0, 0, 0.05))
    obj = bpy.context.active_object
    obj.name = 'Probe'
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
mat = bpy.data.materials.get('Probe') or bpy.data.materials.new('Probe')
bsdf = mat.node_tree.nodes['Principled BSDF']
`;
const keyed = `${cube}
obj.keyframe_insert('location', frame=1)
`;
const geometryNodes = `${cube}
group = bpy.data.node_groups.new('Bump', 'GeometryNodeTree')
group.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
group.interface.new_socket('Height', in_out='INPUT', socket_type='NodeSocketFloat')
group.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
into, out = group.nodes.new('NodeGroupInput'), group.nodes.new('NodeGroupOutput')
group.links.new(into.outputs[0], out.inputs[0])
mod = obj.modifiers.new('Bump', 'NODES')
mod.node_group = group
height = next(i.identifier for i in group.interface.items_tree if i.name == 'Height')
`;
/** A geometry-nodes tree of its own, for a script to add nodes to. */
const nodeTree = `
import mathutils
tree = bpy.data.node_groups.new('Turns', 'GeometryNodeTree')
`;
const light = `${cube}
lamp = bpy.data.lights.get('ProbeLight') or bpy.data.lights.new('ProbeLight', 'POINT')
`;

/** An armature of one bone, in the pose, for a script to use. */
const rigged = `
import bpy
armature = bpy.data.armatures.new('Rig')
obj = bpy.data.objects.new('Rig', armature)
bpy.context.scene.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode='EDIT')
armature.edit_bones.new('Bone').tail = (0, 0, 1)
bpy.ops.object.mode_set(mode='OBJECT')
bone = armature.bones['Bone']
pose_bone = obj.pose.bones['Bone']
`;

const cases: Readonly<Record<string, Case>> = {
  "break:blender/5.2/geometry-nodes-inputs": {
    setup: geometryNodes,
    wrong: ['mod["Socket_1"] = 0.02', "mod[height] = 0.02"],
    right:
      "getattr(mod.properties.inputs, height).value = 0.02\nprint(getattr(mod.properties.inputs, height).value)",
  },
  "break:blender/5.2/slotted-actions": {
    setup: keyed,
    wrong: [
      "print(obj.animation_data.action.fcurves)",
      "print(obj.animation_data.action.groups)",
    ],
    right: `
bag = anim_utils.action_get_channelbag_for_slot(obj.animation_data.action, obj.animation_data.action_slot)
assert [c.data_path for c in bag.fcurves] == ['location'] * 3
made = obj.animation_data.action.fcurve_ensure_for_datablock(obj, 'rotation_euler', index=2)
assert made.data_path == 'rotation_euler'
`,
  },
  "break:blender/5.2/auto-smooth": {
    setup: cube,
    wrong: [
      "obj.data.use_auto_smooth = True",
      "obj.data.auto_smooth_angle = math.radians(30)",
    ],
    right: `
obj.data.shade_smooth()
obj.data.set_sharp_from_angle(angle=math.radians(30))
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))
`,
  },
  "break:blender/5.2/mesh-normals": {
    setup: cube,
    wrong: ["obj.data.calc_normals_split()", "obj.data.calc_normals()"],
    right:
      "assert len(obj.data.corner_normals) == 24 and len(obj.data.vertex_normals) == 8 and len(obj.data.polygon_normals) == 6",
  },
  "break:blender/5.2/edge-creases": {
    setup: cube,
    wrong: [
      "obj.data.edges[0].crease = 1.0",
      "obj.data.edges[0].bevel_weight = 1.0",
    ],
    right: `
obj.data.edge_creases_ensure().data[0].value = 1.0
assert obj.data.attributes['crease_edge'].data[0].value == 1.0
weights = obj.data.attributes.get('bevel_weight_edge') or obj.data.attributes.new('bevel_weight_edge', 'FLOAT', 'EDGE')
weights.data[0].value = 1.0
sub = obj.modifiers.new('Sub', 'SUBSURF')
sub.use_creases = True
`,
  },
  "break:blender/5.2/context-override": {
    setup: cube,
    wrong: [
      "override = bpy.context.copy()\noverride['active_object'] = obj\nbpy.ops.object.shade_smooth(override)",
    ],
    right:
      "with bpy.context.temp_override(active_object=obj, selected_editable_objects=[obj]):\n    bpy.ops.object.shade_smooth()",
  },
  "break:blender/5.2/principled-inputs": {
    setup: cube,
    wrong: [
      "bsdf.inputs['Specular'].default_value = 0.5",
      "bsdf.inputs['Emission'].default_value = (1, 0, 0, 1)",
      "bsdf.inputs['Transmission'].default_value = 1",
      "bsdf.inputs['Clearcoat'].default_value = 1",
      "bsdf.inputs['Subsurface'].default_value = 0.2",
      "bsdf.inputs['Sheen'].default_value = 0.2",
    ],
    right: `
for name in ('Specular IOR Level', 'Transmission Weight', 'Coat Weight', 'Coat Roughness', 'Subsurface Weight', 'Sheen Weight'):
    bsdf.inputs[name].default_value = 0.2
bsdf.inputs['Emission Color'].default_value = (1, 0, 0, 1)
assert 'Coat Normal' in bsdf.inputs and 'Base Color' in bsdf.inputs and 'Roughness' in bsdf.inputs
`,
  },
  "break:blender/5.2/eevee-engine": {
    wrong: ["bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'"],
    right:
      "bpy.context.scene.render.engine = 'BLENDER_EEVEE'\nbpy.context.scene.render.engine = 'CYCLES'",
  },
  "break:blender/5.2/eevee-settings": {
    wrong: [
      "bpy.context.scene.eevee.use_bloom = True",
      "bpy.context.scene.eevee.use_ssr = True",
      "bpy.context.scene.eevee.use_gtao = True",
      "bpy.context.scene.eevee.use_soft_shadows = True",
      "bpy.context.scene.eevee.shadow_cube_size = '1024'",
      "bpy.context.scene.eevee.use_motion_blur = True",
    ],
    right: `
scene = bpy.context.scene
scene.eevee.use_raytracing = True
scene.eevee.shadow_resolution_scale = 1.0
scene.render.use_motion_blur = False
tree = bpy.data.node_groups.new('Glow', 'CompositorNodeTree')
tree.nodes.new('CompositorNodeGlare')
bpy.data.node_groups.remove(tree)
`,
  },
  "break:blender/5.2/shadow-visibility": {
    setup: light,
    wrong: [
      "mat.shadow_method = 'NONE'",
      "obj.cycles_visibility.shadow = False",
      "lamp.cycles.cast_shadow = False",
    ],
    right: "obj.visible_shadow = False\nlamp.use_shadow = False",
  },
  "break:blender/5.2/node-group-interface": {
    setup: "group = bpy.data.node_groups.new('Holes', 'GeometryNodeTree')",
    wrong: [
      "group.inputs.new('NodeSocketFloat', 'Height')",
      "group.outputs.new('NodeSocketGeometry', 'Geometry')",
    ],
    right:
      "group.interface.new_socket('Height', in_out='INPUT', socket_type='NodeSocketFloat')\ngroup.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')",
  },
  "break:blender/5.2/musgrave-texture": {
    setup: cube,
    wrong: [
      "mat.node_tree.nodes.new('ShaderNodeTexMusgrave')",
      "mat.node_tree.nodes.new('ShaderNodeTexNoise').inputs['Dimension'].default_value = 2.0",
    ],
    right: `
noise = mat.node_tree.nodes.new('ShaderNodeTexNoise')
for kind in ('FBM', 'MULTIFRACTAL', 'RIDGED_MULTIFRACTAL', 'HYBRID_MULTIFRACTAL', 'HETERO_TERRAIN'):
    noise.noise_type = kind
lacunarity, dimension, detail = 2.0, 2.0, 3.0
noise.inputs['Lacunarity'].default_value = lacunarity
noise.inputs['Roughness'].default_value = lacunarity ** -dimension
noise.inputs['Detail'].default_value = detail - 1
`,
  },
  "break:blender/5.2/displacement-method": {
    setup: cube,
    wrong: ["mat.cycles.displacement_method = 'BOTH'"],
    right:
      "for way in ('BUMP', 'DISPLACEMENT', 'BOTH'):\n    mat.displacement_method = way",
  },
  "break:blender/5.2/glossy-bsdf": {
    setup: cube,
    wrong: [
      "mat.node_tree.nodes.new('ShaderNodeBsdfGlossy').distribution = 'SHARP'",
      "print(bpy.types.ShaderNodeBsdfGlossy)",
    ],
    right: `
glossy = mat.node_tree.nodes.new('ShaderNodeBsdfGlossy')
assert glossy.bl_idname == 'ShaderNodeBsdfAnisotropic' and glossy.type == 'BSDF_GLOSSY'
assert isinstance(glossy, bpy.types.ShaderNodeBsdfAnisotropic)
glossy.inputs['Anisotropy'].default_value = 0.0
glossy.inputs['Rotation'].default_value = 0.25
glossy.distribution = 'GGX'
glossy.inputs['Roughness'].default_value = 0.0
mat.node_tree.nodes.remove(glossy)
`,
  },
  "break:blender/5.2/velvet-bsdf": {
    setup: cube,
    wrong: ["mat.node_tree.nodes.new('ShaderNodeBsdfVelvet')"],
    right: `
sheen = mat.node_tree.nodes.new('ShaderNodeBsdfSheen')
sheen.distribution = 'ASHIKHMIN'
sheen.distribution = 'MICROFIBER'
bsdf.inputs['Sheen Weight'].default_value = 0.5
mat.node_tree.nodes.remove(sheen)
`,
  },
  "break:blender/5.2/colour-spaces": {
    setup:
      "image = bpy.data.images.get('Probe') or bpy.data.images.new('Probe', 4, 4)",
    wrong: [
      "image.colorspace_settings.name = 'Linear'",
      "image.colorspace_settings.name = 'Raw'",
      "image.colorspace_settings.name = 'XYZ'",
      "image.colorspace_settings.name = 'Linear ACES'",
      "image.colorspace_settings.name = 'Linear ACEScg'",
    ],
    right: `
space = image.colorspace_settings
for name in ('Linear Rec.709', 'Linear CIE-XYZ D65', 'ACES2065-1', 'ACEScg', 'sRGB'):
    space.name = name
    assert not space.is_data
space.name = 'Non-Color'
assert space.is_data
`,
  },
  "break:blender/5.2/image-texture-filter": {
    setup:
      "texture = bpy.data.textures.get('Probe') or bpy.data.textures.new('Probe', 'IMAGE')",
    wrong: [
      "texture.use_mipmap = False",
      "texture.filter_type = 'EWA'",
      "print(texture.filter_eccentricity)",
    ],
    right: `
texture.filter_size = 1.0
texture.use_interpolation = True
texture.extension = 'EXTEND'
`,
  },
  "break:blender/5.2/video-output": {
    wrong: ["bpy.context.scene.render.image_settings.file_format = 'FFMPEG'"],
    right: `
settings = bpy.context.scene.render.image_settings
settings.media_type = 'VIDEO'
settings.file_format = 'FFMPEG'
settings.media_type = 'IMAGE'
settings.file_format = 'PNG'
`,
  },
  "break:blender/5.2/compositor-node-group": {
    wrong: [
      "bpy.context.scene.use_nodes = True\ntree = bpy.context.scene.node_tree",
      "tree = bpy.data.node_groups.new('Comp', 'CompositorNodeTree')\ntree.nodes.new('CompositorNodeComposite')",
    ],
    right: `
scene = bpy.context.scene
tree = bpy.data.node_groups.new('Compositing', 'CompositorNodeTree')
tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
layers, out = tree.nodes.new('CompositorNodeRLayers'), tree.nodes.new('NodeGroupOutput')
tree.links.new(layers.outputs['Image'], out.inputs['Image'])
scene.compositing_node_group = tree
scene.compositing_node_group = None
bpy.data.node_groups.remove(tree)
`,
  },
  "break:blender/5.2/sequencer-strips": {
    setup: "editor = bpy.context.scene.sequence_editor_create()",
    wrong: ["print(editor.sequences)", "print(editor.sequences_all)"],
    right: "print(len(editor.strips), len(editor.strips_all))",
  },
  "break:blender/5.2/legacy-importers": {
    setup: cube,
    wrong: [
      "bpy.ops.export_scene.obj(filepath='part.obj')",
      "bpy.ops.import_scene.obj(filepath='part.obj')",
      "bpy.ops.export_mesh.stl(filepath='part.stl')",
      "bpy.ops.import_mesh.stl(filepath='part.stl')",
      "bpy.ops.wm.collada_export(filepath='part.dae')",
    ],
    right: `
bpy.ops.wm.obj_export(filepath='part.obj', export_selected_objects=True)
bpy.ops.wm.stl_export(filepath='part.stl', export_selected_objects=True)
before = set(bpy.data.objects)
bpy.ops.wm.obj_import(filepath='part.obj')
bpy.ops.wm.stl_import(filepath='part.stl')
for made in set(bpy.data.objects) - before:
    bpy.data.objects.remove(made)
bpy.ops.export_scene.gltf(filepath='part.glb', use_selection=True)
`,
  },
  "break:blender/5.2/view-looks": {
    wrong: [
      "bpy.context.scene.view_settings.view_transform = 'Filmic'\nbpy.context.scene.view_settings.look = 'Filmic - High Contrast'",
    ],
    right: `
view = bpy.context.scene.view_settings
view.view_transform = 'Filmic'
view.look = 'High Contrast'
view.view_transform = 'AgX'
view.look = 'AgX - High Contrast'
view.look = 'None'
`,
  },
  "break:blender/5.2/matrix-multiplication": {
    setup: cube,
    wrong: ["print(obj.matrix_world * mathutils.Vector((1, 0, 0)))"],
    right: "print(obj.matrix_world @ mathutils.Vector((1, 0, 0)))",
  },
  "break:blender/5.2/matrix-sockets": {
    setup: nodeTree,
    wrong: [
      "node = tree.nodes.new('GeometryNodeSetInstanceTransform')\nnode.inputs['Transform'].default_value = mathutils.Matrix.Translation((0, 0, 1))",
    ],
    right: `
node = tree.nodes.new('GeometryNodeSetInstanceTransform')
combine = tree.nodes.new('FunctionNodeCombineTransform')
combine.inputs['Translation'].default_value = (0, 0, 1)
assert tree.links.new(combine.outputs['Transform'], node.inputs['Transform']).is_valid
`,
  },
  "break:blender/5.2/transform-geometry-mode": {
    setup: nodeTree,
    wrong: [
      "transform = tree.nodes.new('GeometryNodeTransform')\ntransform.inputs[1].default_value = (0, 0, 1)",
      "transform = tree.nodes.new('GeometryNodeTransform')\ntransform.inputs[1].default_value = [0, 0, 1]",
    ],
    right: `
transform = tree.nodes.new('GeometryNodeTransform')
transform.inputs['Translation'].default_value = (0, 0, 1)
assert transform.inputs['Mode'].default_value == 'Components'
`,
  },
  "break:blender/5.2/rotation-sockets": {
    setup: nodeTree,
    wrong: [
      "rotate = tree.nodes.new('FunctionNodeRotateEuler')\nrotate.type = 'AXIS_ANGLE'",
    ],
    right: `
turn = tree.nodes.new('FunctionNodeAxisAngleToRotation')
turn.inputs['Angle'].default_value = 0.5
rotate = tree.nodes.new('FunctionNodeRotateRotation')
rotate.rotation_space = 'LOCAL'
tree.links.new(turn.outputs[0], rotate.inputs['Rotate By'])
align = tree.nodes.new('FunctionNodeAlignRotationToVector')
assert tree.links.new(rotate.outputs[0], align.inputs['Rotation']).is_valid
assert align.outputs['Rotation'].type == 'ROTATION'
`,
  },
  "break:blender/5.2/selection-and-hiding": {
    setup: cube,
    wrong: ["obj.select = True", "obj.hide = True"],
    right:
      "obj.select_set(True)\nobj.hide_set(True)\nobj.hide_set(False)\nobj.hide_viewport = False\nobj.hide_render = False",
  },
  "break:blender/5.2/bone-collections": {
    setup: rigged,
    wrong: ["armature.layers[1] = True", "print(bone.layers)"],
    right:
      "body = armature.collections.new('Body')\nbody.assign(bone)\nassert [c.name for c in bone.collections] == ['Body']\nbody.is_visible = False",
  },
  "break:blender/5.2/bone-colors": {
    setup: rigged,
    wrong: ["print(obj.pose.bone_groups)", "print(pose_bone.bone_group)"],
    right:
      "pose_bone.color.palette = 'THEME01'\nbone.color.palette = 'THEME02'\nassert pose_bone.color.palette == 'THEME01'",
  },
  "break:blender/5.2/bone-selection": {
    setup: rigged,
    wrong: ["bone.select = True", "print(bone.select_head)"],
    right: "pose_bone.select = True\nassert pose_bone.select",
  },
};

/** A change 5.2 runs in silence: the old form, with the script's own checks of what 5.2 does with it. */
const quietCases: Readonly<Record<string, { readonly code: string }>> = {
  "quiet:blender/5.2/blend-method": {
    code: `
for old, now in (('OPAQUE', 'DITHERED'), ('CLIP', 'DITHERED'), ('HASHED', 'DITHERED'), ('BLEND', 'BLENDED')):
    mat.blend_method = old
    assert mat.surface_render_method == now, (old, mat.surface_render_method)
`,
  },
  "quiet:blender/5.2/use-nodes": {
    code: `
mat.use_nodes = False
assert mat.use_nodes and mat.node_tree.nodes.get('Principled BSDF') is not None
world = bpy.data.worlds.new('Probe')
world.use_nodes = False
assert world.use_nodes
bpy.data.worlds.remove(world)
`,
  },
  "quiet:blender/5.2/transparency-overlap": {
    code: `
mat.show_transparent_back = False
assert not mat.use_transparency_overlap
mat.show_transparent_back = True
assert mat.use_transparency_overlap
`,
  },
  "quiet:blender/5.2/raytrace-refraction": {
    code: `
mat.use_screen_refraction = True
assert mat.use_raytrace_refraction
mat.use_screen_refraction = False
assert not mat.use_raytrace_refraction
`,
  },
  "quiet:blender/5.2/glossy-names": {
    code: `
glossy = mat.node_tree.nodes.new('ShaderNodeBsdfGlossy')
assert not glossy.bl_idname == 'ShaderNodeBsdfGlossy'
assert glossy.type != 'BSDF_ANISOTROPIC' and glossy.type == 'BSDF_GLOSSY'
mat.node_tree.nodes.remove(glossy)
`,
  },
};

describe.runIf(blender)("a real Blender 5.2", () => {
  const folders = new TemporaryFolders();
  let root: string;
  let workspace: string;
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const launches: unknown[] = [];
  const studio = (): ConversationScenes => {
    const contained = withKeptGlCache(containedSessionLaunch)(
      { open: openProcessContainer },
      { scripts: join(root, "session-scripts") },
    );
    const counted: LaunchSession = (options) => {
      launches.push(options);
      return contained(options);
    };
    return new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: counted,
      script: sessionScript,
    });
  };
  const script = async (code: string) => {
    const result = (await tools.callTool("blender_run_script", {
      code: code.trim(),
    })) as Result;
    return {
      ...result,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };

  beforeAll(async () => {
    root = await folders.make("zhiyin-studio-knowledge-");
    workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    scenes = studio();
    tools = sceneAutomation(scenes.scene("knowledge"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("knowledge"),
    });
    const opened = (await tools.callTool("blender_open_scene", {
      path: "knowledge.blend",
      create: true,
    })) as Result;
    expect(opened.isError).toBeUndefined();
  }, 180_000);

  afterAll(async () => {
    await scenes.forget("knowledge");
    await scenes.closeAll();
    await folders.removeAll();
  });

  describe("its API, read from it", () => {
    it("holds a known type's properties, a node's inputs by name and an operator's parameters", async () => {
      const knowledge = scenes.knowledge();

      const object = await knowledge.page("doc:blender/5.2/bpy.types.Object");
      const modifier = await knowledge.page(
        "doc:blender/5.2/bpy.types.NodesModifier",
      );
      const principled = await knowledge.page(
        "doc:blender/5.2/bpy.types.ShaderNodeBsdfPrincipled",
      );
      const bevel = await knowledge.page("doc:blender/5.2/bmesh.ops.bevel");
      const entries = await knowledge.entries();

      expect(object?.text).toContain(
        "bpy.types.Object, as Blender 5.2.2 LTS has it.",
      );
      expect(object?.text).toContain(
        "- location (float[3]): Location of the object",
      );
      expect(modifier?.text).toContain("- node_group (pointer of NodeTree)");
      expect(principled?.text).toContain("- Specular IOR Level (value");
      expect(bevel?.text).toContain("bmesh.ops.bevel(bmesh, geom=[]");
      expect(entries.length).toBeGreaterThan(2_000);
      expect(entries.map((entry) => entry.id)).not.toContain("doc:blender/api");
    }, 180_000);

    it("is kept, so the next run of the app opens it without starting Blender", async () => {
      await scenes.knowledge().page("doc:blender/5.2/bpy.types.Object");
      const before = launches.length;
      const later = studio();

      const mesh = await later
        .knowledge()
        .page("doc:blender/5.2/bpy.types.Mesh");

      expect(mesh?.text).toContain("from_pydata(");
      expect(launches.length).toBe(before);
      await later.closeAll();
    }, 180_000);

    it("has a page for every page an API change names", async () => {
      const knowledge = scenes.knowledge();
      const named = [...new Set(apiBreaks.flatMap((change) => change.see))];

      const missing = [];
      for (const id of named)
        if (!(await knowledge.page(id))?.text.includes("as Blender 5.2"))
          missing.push(id);

      expect(missing).toEqual([]);
    }, 180_000);
  });

  describe("an API change", () => {
    it("is checked here, each one", () => {
      expect(Object.keys(cases).sort()).toEqual(
        apiBreaks.map((change) => change.id).sort(),
      );
    });

    for (const change of apiBreaks) {
      const known = cases[change.id];
      if (!known) continue;
      it(`${change.title}: the old form is answered with the new, which runs`, async () => {
        const answers = [];
        for (const wrong of known.wrong)
          answers.push(await script(`${known.setup ?? ""}\n${wrong}`));
        const right = await script(`${known.setup ?? ""}\n${known.right}`);

        for (const answer of answers) {
          expect(answer.isError, answer.said).toBe(true);
          expect(answer.said).toContain(
            `To read: open ${change.see.join(", ")}.`,
          );
          // Where the session's own answer gives the new form, by the
          // script's own names, it is not given twice.
          const saidAlready =
            change.saidBySession !== undefined &&
            answer.said.includes(change.saidBySession);
          expect(answer.said.includes(`Instead of ${change.wrong}:`)).toBe(
            !saidAlready,
          );
        }
        expect(right.isError, right.said).toBeUndefined();
      }, 180_000);
    }
  });

  describe("a change Blender 5.2 runs without an error", () => {
    it("is checked here, each one", () => {
      expect(Object.keys(quietCases).sort()).toEqual(
        quietChanges.map((change) => change.id).sort(),
      );
    });

    for (const change of quietChanges) {
      const known = quietCases[change.id];
      if (!known) continue;
      it(`${change.title}: the old form runs, does what the answer says, and the answer says it`, async () => {
        const ran = await script(`${cube}\n${known.code}\nprint("held")`);

        expect(ran.isError, ran.said).toBeUndefined();
        // The script's own checks of what 5.2 does with the old form held.
        expect(ran.said).toContain("held");
        expect(ran.said).toContain(
          `Blender 5.2 runs this script's ${change.wrong.split(" ")[0]} without an error, but ${change.said}`,
        );
      }, 180_000);
    }

    it("is not said for a name in a comment only", async () => {
      const ran = await script(
        `${cube}\n# mat.blend_method = 'CLIP' was the old way\nmat.surface_render_method = 'DITHERED'`,
      );

      expect(ran.said).not.toContain("blend_method without an error");
    }, 180_000);
  });

  it("has every input and type the Noise texture page names", async () => {
    const page = writtenPages.find(
      (one) => one.id === "doc:3d-rendering/noise-texture",
    )!;
    const ran = await script(`${cube}
noise = mat.node_tree.nodes.new('ShaderNodeTexNoise')
reads = {}
for kind in [i.identifier for i in noise.bl_rna.properties['noise_type'].enum_items]:
    noise.noise_type = kind
    reads[kind] = sorted(s.name for s in noise.inputs if s.enabled and s.name not in ('Vector', 'W'))
print(sorted(reads.items()))
print(noise.outputs['Fac'] == noise.outputs['Factor'], noise.outputs[0].name, noise.normalize)
`);

    expect(ran.isError, ran.said).toBeUndefined();
    const types = [...page.text.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(new Set(types)).toEqual(
      new Set([
        "FBM",
        "MULTIFRACTAL",
        "RIDGED_MULTIFRACTAL",
        "HYBRID_MULTIFRACTAL",
        "HETERO_TERRAIN",
      ]),
    );
    const base = "'Detail', 'Distortion', 'Lacunarity', 'Roughness', 'Scale'";
    expect(ran.said).toContain(
      `[('FBM', [${base}]), ('HETERO_TERRAIN', ['Detail', 'Distortion', 'Lacunarity', 'Offset', 'Roughness', 'Scale']), ('HYBRID_MULTIFRACTAL', ['Detail', 'Distortion', 'Gain', 'Lacunarity', 'Offset', 'Roughness', 'Scale']), ('MULTIFRACTAL', [${base}]), ('RIDGED_MULTIFRACTAL', ['Detail', 'Distortion', 'Gain', 'Lacunarity', 'Offset', 'Roughness', 'Scale'])]`,
    );
    expect(ran.said).toContain("True Factor True");
  }, 180_000);
});
