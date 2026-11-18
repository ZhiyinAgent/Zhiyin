/**
 * What changed in Blender's Python API between the Blenders models were
 * trained on and 5.2, the one Zhiyin runs (ADR 0024). Each change is matched
 * by the error a script written the old way raises in Blender 5.2, and is
 * answered with the form that works there and the pages to read.
 */

import type { ApiBreak } from "@zhiyin/contract";
import { matchBreaks } from "@zhiyin/catalog-search";

/** A change, with the words its catalog entry is found by. */
export type KnownBreak = ApiBreak & {
  /** `break:blender/5.2/<slug>`. */
  readonly id: string;
  readonly title: string;
  /**
   * Words the session's own answer gives the new form in, for the failed
   * line by the script's own names: where they are there, only the pages
   * are added.
   */
  readonly saidBySession?: string;
};

const reference = (name: string) => `doc:blender/5.2/${name}`;

export const apiBreaks: readonly KnownBreak[] = [
  {
    id: "break:blender/5.2/geometry-nodes-inputs",
    title: "A geometry-nodes modifier's inputs are no longer subscripts",
    pattern:
      "id properties not supported for this type|doesn't support IDProperties",
    wrong: 'mod["Socket_2"] = 0.5',
    right:
      "mod.properties.inputs.Socket_2.value = 0.5, by the input's identifier; getattr(mod.properties.inputs, identifier) takes one held in a variable.",
    see: [reference("bpy.types.NodesModifier")],
    saidBySession: "In Blender 5.2 a geometry-nodes modifier's inputs",
  },
  {
    id: "break:blender/5.2/slotted-actions",
    title: "An action's F-curves are in its slots' channelbags",
    pattern: "'Action' object has no attribute '(fcurves|groups|id_root)'",
    wrong: "obj.animation_data.action.fcurves",
    right:
      "from bpy_extras import anim_utils, then anim_utils.action_get_channelbag_for_slot(action, obj.animation_data.action_slot).fcurves; action.fcurve_ensure_for_datablock(obj, data_path, index=i) makes one. fcurves_of(obj), given to every script, lists a block's F-curves in one call.",
    see: [
      reference("bpy_extras.anim_utils"),
      reference("bpy.types.ActionChannelbag"),
      reference("bpy.types.Action"),
    ],
  },
  {
    id: "break:blender/5.2/auto-smooth",
    title: "Auto smooth is gone from meshes",
    pattern:
      "'Mesh' object has no attribute '(use_auto_smooth|auto_smooth_angle)'",
    wrong: "mesh.use_auto_smooth = True; mesh.auto_smooth_angle = angle",
    right:
      "mesh.shade_smooth(), then mesh.set_sharp_from_angle(angle=math.radians(30)); or, with the object active and selected, bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30)).",
    see: [reference("bpy.types.Mesh")],
  },
  {
    id: "break:blender/5.2/mesh-normals",
    title: "A mesh's normals are always up to date",
    pattern:
      "'Mesh' object has no attribute '(calc_normals|calc_normals_split|free_normals_split|create_normals_split)'",
    wrong: "mesh.calc_normals_split()",
    right:
      "Leave the call out: mesh.corner_normals, mesh.vertex_normals and mesh.polygon_normals are always current.",
    see: [reference("bpy.types.Mesh")],
  },
  {
    id: "break:blender/5.2/edge-creases",
    title: "Edge creases are a mesh attribute",
    pattern: "'MeshEdge' object has no attribute '(crease|bevel_weight)'",
    wrong: "mesh.edges[0].crease = 1.0",
    right:
      "mesh.edge_creases_ensure().data[0].value = 1.0, the attribute crease_edge, which a Subdivision Surface modifier follows with use_creases; a bevel weight is the float attribute bevel_weight_edge on the EDGE domain.",
    see: [reference("bpy.types.Mesh"), reference("bpy.types.SubsurfModifier")],
  },
  {
    id: "break:blender/5.2/context-override",
    title: "An operator's context is overridden with temp_override",
    pattern: "1-2 args execution context is supported",
    wrong: "bpy.ops.object.shade_smooth(override)",
    right:
      "with bpy.context.temp_override(active_object=obj, selected_editable_objects=[obj]): bpy.ops.object.shade_smooth()",
    see: [reference("bpy.types.Context")],
  },
  {
    id: "break:blender/5.2/principled-inputs",
    title: "The Principled BSDF's inputs were renamed",
    pattern:
      'key "(Specular|Emission|Transmission|Transmission Roughness|Clearcoat|Clearcoat Roughness|Clearcoat Normal|Subsurface|Subsurface Color|Sheen)" not found',
    wrong: 'bsdf.inputs["Specular"]',
    right:
      "On a Principled BSDF, Specular is Specular IOR Level, Emission is Emission Color, Transmission is Transmission Weight, Clearcoat is Coat Weight (Clearcoat Roughness and Normal are Coat Roughness and Coat Normal), Subsurface is Subsurface Weight, and Sheen is Sheen Weight; Subsurface Color and Transmission Roughness are gone, Base Color and Roughness serving instead.",
    see: [reference("bpy.types.ShaderNodeBsdfPrincipled")],
  },
  {
    id: "break:blender/5.2/eevee-engine",
    title: "EEVEE is BLENDER_EEVEE again",
    pattern: 'enum "BLENDER_EEVEE_NEXT" not found',
    wrong: "scene.render.engine = 'BLENDER_EEVEE_NEXT'",
    right: "scene.render.engine = 'BLENDER_EEVEE'",
    see: [reference("bpy.types.RenderSettings")],
  },
  {
    id: "break:blender/5.2/eevee-settings",
    title:
      "EEVEE's legacy bloom, reflection, occlusion and shadow settings are gone",
    pattern:
      "'SceneEEVEE' object has no attribute '(use_bloom|bloom_\\w+|use_ssr\\w*|ssr_\\w+|use_gtao\\w*|gtao_\\w+|use_soft_shadows|shadow_cube_size|shadow_cascade_size|use_motion_blur|motion_blur_\\w+)'",
    wrong: "scene.eevee.use_bloom = True; scene.eevee.use_ssr = True",
    right:
      "Reflections and ambient occlusion come from scene.eevee.use_raytracing = True; shadows are sharp or soft by each light's size, their detail scene.eevee.shadow_resolution_scale; motion blur is scene.render.use_motion_blur; bloom is a Glare node in the compositor.",
    see: [
      reference("bpy.types.SceneEEVEE"),
      reference("bpy.types.CompositorNodeGlare"),
    ],
  },
  {
    id: "break:blender/5.2/shadow-visibility",
    title:
      "Whether an object casts shadows is the object's, and a light's its own",
    pattern:
      "'Material' object has no attribute 'shadow_method'|'Object' object has no attribute 'cycles_visibility'|'CyclesLightSettings' object has no attribute 'cast_shadow'",
    wrong: "material.shadow_method = 'NONE'; light.cycles.cast_shadow = False",
    right:
      "obj.visible_shadow = False for an object that casts none; light.use_shadow = False for a light.",
    see: [reference("bpy.types.Object"), reference("bpy.types.Light")],
  },
  {
    id: "break:blender/5.2/node-group-interface",
    title: "A node group's inputs and outputs are made on its interface",
    pattern: "'\\w*NodeTree' object has no attribute '(inputs|outputs)'",
    wrong: "group.inputs.new('NodeSocketFloat', 'Height')",
    right:
      "group.interface.new_socket('Height', in_out='INPUT', socket_type='NodeSocketFloat'); in_out='OUTPUT' for an output.",
    see: [reference("bpy.types.NodeTreeInterface")],
  },
  {
    id: "break:blender/5.2/musgrave-texture",
    title: "The Musgrave texture is part of the Noise texture",
    pattern:
      'Node type ShaderNodeTexMusgrave undefined|key "Dimension" not found',
    wrong: "nodes.new('ShaderNodeTexMusgrave')",
    right:
      "nodes.new('ShaderNodeTexNoise') with noise_type 'FBM', 'MULTIFRACTAL', 'RIDGED_MULTIFRACTAL', 'HYBRID_MULTIFRACTAL' or 'HETERO_TERRAIN'; Dimension is gone, its Roughness input is Lacunarity ** -Dimension, and its Detail is the old Detail less 1 (Musgrave's Detail 3 is Noise's 2).",
    see: [reference("bpy.types.ShaderNodeTexNoise")],
  },
  {
    id: "break:blender/5.2/displacement-method",
    title: "A material's displacement method is the material's own",
    pattern:
      "'CyclesMaterialSettings' object has no attribute 'displacement_method'",
    wrong: "material.cycles.displacement_method = 'BOTH'",
    right:
      "material.displacement_method = 'BOTH', or 'BUMP' or 'DISPLACEMENT'; a displacement that moves points also needs edges finer than its detail.",
    see: [reference("bpy.types.Material")],
  },
  {
    id: "break:blender/5.2/glossy-bsdf",
    title: "The Glossy and Anisotropic BSDFs are one node, and Sharp is gone",
    pattern:
      "no attribute 'ShaderNodeBsdfGlossy'|enum \"SHARP\" not found in \\('BECKMANN'",
    wrong: "glossy.distribution = 'SHARP'",
    right:
      "nodes.new('ShaderNodeBsdfGlossy') still makes a Glossy BSDF, whose bl_idname is ShaderNodeBsdfAnisotropic and type BSDF_GLOSSY, with Anisotropy (0 for the old Glossy), Rotation and Tangent inputs; isinstance(node, bpy.types.ShaderNodeBsdfAnisotropic) tests for one. A mirror reflection is distribution 'GGX' with Roughness 0.",
    see: [reference("bpy.types.ShaderNodeBsdfAnisotropic")],
  },
  {
    id: "break:blender/5.2/velvet-bsdf",
    title: "The Velvet BSDF is the Sheen BSDF",
    pattern: "Node type ShaderNodeBsdfVelvet undefined",
    wrong: "nodes.new('ShaderNodeBsdfVelvet')",
    right:
      "nodes.new('ShaderNodeBsdfSheen'), whose distribution 'ASHIKHMIN' is the old Velvet's model and 'MICROFIBER' the default; a Principled BSDF's Sheen Weight gives cloth its sheen too.",
    see: [reference("bpy.types.ShaderNodeBsdfSheen")],
  },
  {
    id: "break:blender/5.2/colour-spaces",
    title: "Colour spaces are named by what they are",
    pattern:
      "enum \"(Linear|Raw|Utility - Raw|XYZ|Linear ACES|Linear ACEScg)\" not found in \\('ACES 1\\.3 sRGB'",
    wrong: "image.colorspace_settings.name = 'Linear'",
    right:
      "'Linear Rec.709' for linear colour, 'Non-Color' for data such as roughness, normal and height maps (Raw is a view now, not a colour space), 'Linear CIE-XYZ D65' for XYZ, 'ACES2065-1' and 'ACEScg' for the linear ACES spaces; image.colorspace_settings.is_data is True for Non-Color.",
    see: [reference("bpy.types.ColorManagedInputColorspaceSettings")],
  },
  {
    id: "break:blender/5.2/image-texture-filter",
    title: "An image texture's filter settings are gone",
    pattern:
      "'ImageTexture' object has no attribute '(filter_type|use_mipmap|use_mipmap_gauss|filter_lightprobes|filter_eccentricity|use_filter_size_min)'",
    wrong: "texture.use_mipmap = False; texture.filter_type = 'EWA'",
    right:
      "Leave them out: they did nothing since 2.80. filter_size, use_interpolation and extension remain; a picture node's own filtering is ShaderNodeTexImage.interpolation, 'Linear', 'Closest', 'Cubic' or 'Smart'.",
    see: [
      reference("bpy.types.ImageTexture"),
      reference("bpy.types.ShaderNodeTexImage"),
    ],
  },
  {
    id: "break:blender/5.2/video-output",
    title: "A video's format follows its media type",
    pattern: 'enum "FFMPEG" not found in',
    wrong: "scene.render.image_settings.file_format = 'FFMPEG'",
    right:
      "scene.render.image_settings.media_type = 'VIDEO' first, then file_format = 'FFMPEG'; blender_render_video writes a video without a script.",
    see: [reference("bpy.types.ImageFormatSettings")],
  },
  {
    id: "break:blender/5.2/compositor-node-group",
    title: "The compositor is a node group the scene names",
    pattern:
      "'Scene' object has no attribute 'node_tree'|Node type CompositorNodeComposite undefined",
    wrong: "scene.use_nodes = True; tree = scene.node_tree",
    right:
      "tree = bpy.data.node_groups.new('Compositing', 'CompositorNodeTree'); scene.compositing_node_group = tree; the picture leaves through a Group Output node, with an Image socket made by tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor').",
    see: [
      reference("bpy.types.Scene"),
      reference("bpy.types.CompositorNodeTree"),
    ],
  },
  {
    id: "break:blender/5.2/sequencer-strips",
    title: "The sequencer's sequences are strips",
    pattern:
      "'SequenceEditor' object has no attribute '(sequences|sequences_all)'",
    wrong: "scene.sequence_editor.sequences",
    right: "scene.sequence_editor.strips, and strips_all for every level.",
    see: [reference("bpy.types.SequenceEditor")],
  },
  {
    id: "break:blender/5.2/legacy-importers",
    title: "OBJ, STL and Collada have new operators or none",
    pattern:
      'Calling operator "bpy\\.ops\\.(export_scene\\.obj|import_scene\\.obj|export_mesh\\.stl|import_mesh\\.stl|wm\\.collada_export|wm\\.collada_import)" error, could not be found',
    wrong: "bpy.ops.export_scene.obj(filepath='part.obj')",
    right:
      "bpy.ops.wm.obj_export, wm.obj_import, wm.stl_export and wm.stl_import; Collada is gone, so export glTF with bpy.ops.export_scene.gltf. blender_export writes a model file, USD included, without a script.",
    see: [reference("bpy.ops.wm")],
  },
  {
    id: "break:blender/5.2/view-looks",
    title: "Filmic's looks are named without the view",
    pattern: 'enum "Filmic - [^"]+" not found',
    wrong: "scene.view_settings.look = 'Filmic - High Contrast'",
    right:
      "scene.view_settings.look = 'High Contrast' under Filmic; AgX, the default view, keeps its names, as 'AgX - High Contrast'.",
    see: [reference("bpy.types.ColorManagedViewSettings")],
  },
  {
    id: "break:blender/5.2/matrix-multiplication",
    title: "Matrices multiply with @",
    pattern: "Element-wise multiplication: not supported between 'Matrix' and",
    wrong: "obj.matrix_world * vector",
    right: "obj.matrix_world @ vector",
    see: [reference("mathutils.Matrix")],
  },
  {
    id: "break:blender/5.2/matrix-sockets",
    title: "A geometry-nodes matrix input takes a link, not a value",
    pattern: "'NodeSocketMatrix' object has no attribute 'default_value'",
    wrong: 'node.inputs["Transform"].default_value = matrix',
    right:
      'link a matrix into it: FunctionNodeCombineTransform makes one from Translation, Rotation and Scale, FunctionNodeCombineMatrix from its sixteen values, as tree.links.new(combine.outputs["Transform"], node.inputs["Transform"]). Set Instance Transform takes one so, as Transform Geometry does in its Matrix mode.',
    see: [
      reference("bpy.types.GeometryNodeSetInstanceTransform"),
      reference("bpy.types.FunctionNodeCombineTransform"),
    ],
  },
  {
    id: "break:blender/5.2/transform-geometry-mode",
    title: "Transform Geometry's inputs begin with its Mode",
    pattern: "expected a string enum, not (tuple|list|Vector|Euler)",
    wrong: "transform.inputs[1].default_value = (0, 0, 1)",
    right:
      "transform.inputs['Translation'].default_value = (0, 0, 1): its second input is Mode, 'Components' or 'Matrix', so take its inputs by name: Translation, Rotation and Scale, or Transform in Matrix mode.",
    see: [reference("bpy.types.GeometryNodeTransform")],
  },
  {
    id: "break:blender/5.2/rotation-sockets",
    title: "Geometry nodes turn with rotations, not Euler vectors",
    pattern: 'attribute "type" from "FunctionNodeRotateEuler" is read-only',
    wrong:
      "rotate = tree.nodes.new('FunctionNodeRotateEuler'); rotate.type = 'AXIS_ANGLE'",
    right:
      "FunctionNodeRotateRotation turns a Rotation by another (rotation_space 'OBJECT' or 'LOCAL'), FunctionNodeAxisAngleToRotation makes one from Axis and Angle, and FunctionNodeAlignRotationToVector turns one toward a Vector, replacing Align Euler to Vector. The Euler nodes still load in 5.2 but take and give Euler vectors.",
    see: [
      reference("bpy.types.FunctionNodeRotateRotation"),
      reference("bpy.types.FunctionNodeAlignRotationToVector"),
    ],
  },
  {
    id: "break:blender/5.2/selection-and-hiding",
    title: "Selecting and hiding are calls",
    pattern: "'Object' object has no attribute '(select|hide)'",
    wrong: "obj.select = True; obj.hide = True",
    right:
      "obj.select_set(True); obj.hide_set(True) in the view, or obj.hide_viewport and obj.hide_render.",
    see: [reference("bpy.types.Object")],
  },
  {
    id: "break:blender/5.2/bone-collections",
    title: "Bone layers are bone collections",
    pattern: "'(Armature|Bone|EditBone)' object has no attribute 'layers'",
    wrong: "armature.layers[1] = True; bone.layers[1] = True",
    right:
      "body = armature.collections.new('Body'), then body.assign(bone); bone.collections lists a bone's collections, body.is_visible shows or hides them, and armature.collections_all finds one nested in another.",
    see: [
      reference("bpy.types.BoneCollection"),
      reference("bpy.types.Armature"),
    ],
  },
  {
    id: "break:blender/5.2/bone-colors",
    title: "Bone groups are bone colours",
    pattern:
      "'Pose' object has no attribute 'bone_groups'|'PoseBone' object has no attribute 'bone_group'",
    wrong:
      "obj.pose.bone_groups.new(name='Left'); pose_bone.bone_group = group",
    right:
      "pose_bone.color.palette = 'THEME01' in the pose, or bone.color.palette = 'THEME01' on the armature's bone; gather bones with bone collections.",
    see: [reference("bpy.types.BoneColor"), reference("bpy.types.PoseBone")],
  },
  {
    id: "break:blender/5.2/bone-selection",
    title: "An armature's bones are selected in the pose or in edit mode",
    pattern: "'Bone' object has no attribute 'select(_head|_tail)?'",
    wrong: "armature.bones['Bone'].select = True",
    right:
      "obj.pose.bones['Bone'].select = True in the pose, or armature.edit_bones['Bone'].select = True in edit mode.",
    see: [reference("bpy.types.PoseBone"), reference("bpy.types.EditBone")],
  },
];

/** What a failed script's error shows Blender 5.2 changed, in words for the answer, or nothing. */
export function changesSaid(error: string): string {
  const matched = matchBreaks(apiBreaks, error) as readonly KnownBreak[];
  return matched
    .map((change) => {
      const read = `To read: open ${change.see.join(", ")}.`;
      if (change.saidBySession && error.includes(change.saidBySession))
        return read;
      const right = /[.)]$/.test(change.right)
        ? change.right
        : `${change.right}.`;
      return `Blender 5.2 changed this. Instead of ${change.wrong}: ${right} ${read}`;
    })
    .join("\n");
}
