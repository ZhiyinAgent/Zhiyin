/**
 * One step of blender_shape_objects as its schema takes it: every kind's
 * inputs in one object, each named for the kind it belongs to. What each does
 * in detail is on doc:3d-rendering/shaping; each description here names the
 * kinds that take the input and says what the name cannot.
 */

import { point2, vector3, workspaceFile } from "./schema-parts.js";
import { statedNumbers } from "./stated-numbers.js";

const shape = statedNumbers.shape;

const axes = (description: string) => ({
  type: "array",
  items: { type: "string", enum: ["x", "y", "z"] },
  description,
});
const choice = (values: readonly string[], description: string) => ({
  type: "string",
  enum: values,
  description,
});
const flag = (description: string) => ({ type: "boolean", description });
const amount = (description: string) => ({ type: "number", description });
/** A value held from 0 to 1. */
const share = { minimum: 0, maximum: 1 };
const count = (description: string) => ({ type: "integer", description });
const named = (description: string) => ({ type: "string", description });

const shapeKinds = [
  "boolean",
  "bevel",
  "array",
  "mirror",
  "solidify",
  "subdivision",
  "smooth",
  "remesh",
  "weighted_normals",
  "triangulate",
  "hard_surface",
  "displace",
  "shrinkwrap",
  "curve",
  "remove",
] as const;

export const shapeStep = {
  type: "object",
  properties: {
    kind: choice(
      shapeKinds,
      "curve sets a curve object's geometry; every other kind is for a mesh.",
    ),
    operation: choice(
      ["difference", "union", "intersect"],
      "boolean: difference takes the other away, union adds it, intersect keeps only their overlap.",
    ),
    with: {
      type: "string",
      description:
        "boolean: an object to combine with, hidden afterwards unless keep_visible.",
    },
    collection: named(
      "boolean: a collection whose meshes all combine with it, hidden from pictures unless keep_visible.",
    ),
    keep_visible: flag("boolean: leave with or the collection in pictures."),
    solver: choice(
      ["auto", "exact", "float", "manifold"],
      "boolean: exact by default; auto picks one for the shapes and says why.",
    ),
    self_intersection: flag(
      "boolean, exact solver: resolve where a shape crosses itself.",
    ),
    hole_tolerant: flag(
      "boolean, exact solver: take shapes with holes in their surface.",
    ),
    cutter: {
      type: "object",
      description:
        "boolean: a cutting shape made for this call, kept as its own object so it can be moved later.",
      properties: {
        shape: choice(
          [
            "cylinder",
            "box",
            "sphere",
            "rounded_box",
            "slot",
            "outline",
            "text",
          ],
          "Its form, each taking the sizes named for it.",
        ),
        diameter: amount("cylinder, sphere: in metres."),
        depth: amount("cylinder, outline, text: along its z, in metres."),
        size: vector3(
          "Size in metres; a box needs one. A slot's x is its length, y its width with round ends.",
        ),
        radius: {
          type: "number",
          description:
            "rounded_box: how round its upright edges are, in metres.",
        },
        points: {
          type: "array",
          items: point2,
          description: "outline: [x, y] about the cutter's centre, in metres.",
        },
        text: named("text: the letters, centred, reading along its x."),
        height: {
          type: "number",
          description: "text: the letters' height, in metres.",
        },
        segments: count(
          "How many sides round a cylinder or sphere, or points round a rounded box's or slot's four corners.",
        ),
        location: vector3("Centre of the cutter, in metres."),
        rotation: vector3(
          "Rotation in degrees; a cutter stands along z, as a cylinder's axis or a slot's depth.",
        ),
      },
      required: ["location"],
    },
    width: {
      type: "number",
      description:
        "bevel, hard_surface: in metres, at most half the thinnest side; a percentage with width_type percent.",
    },
    width_type: choice(
      ["offset", "width", "depth", "percent", "absolute"],
      "bevel, hard_surface: what width measures: from the edge to each side, across the new face, its depth in, a percentage of the edges beside, or along each edge.",
    ),
    segments: count(
      "bevel, hard_surface: how many faces across each rounded edge.",
    ),
    angle: {
      type: "number",
      description:
        "bevel, smooth, hard_surface, subdivision crease: edges sharper than this many degrees.",
    },
    limit: choice(
      ["angle", "none", "weight", "attribute", "vertex_group"],
      "bevel: the edges it rounds: sharper than angle, all, those with a bevel weight, those weighted in attribute, or those in vertex_group.",
    ),
    vertex_group: named(
      "bevel, displace, shrinkwrap: a vertex group of the mesh, the only points it changes.",
    ),
    attribute: named(
      "bevel: an edge attribute; the edges above 0 in it are rounded.",
    ),
    profile: {
      ...amount(
        "bevel, hard_surface: its shape, 0 hollowed in, 1 square; 0.5 round.",
      ),
      ...share,
    },
    miter_outer: choice(
      ["sharp", "patch", "arc"],
      "bevel, hard_surface: how an outer corner where bevels meet is filled.",
    ),
    miter_inner: choice(
      ["sharp", "arc"],
      "bevel: how an inner corner where bevels meet is filled.",
    ),
    clamp: flag(
      "bevel, hard_surface: false lets bevels cross each other where they meet.",
    ),
    harden_normals: flag("bevel: the faces beside it keep shading flat."),
    face_strength: choice(
      ["none", "new", "affected", "all"],
      "bevel: the faces given a strength for weighted_normals: the new ones, those and their neighbours, or all.",
    ),
    count: count("array: how many in all, the first included."),
    offset: vector3("array: step between copies, in metres."),
    relative: vector3("array: step as multiples of its own size."),
    offset_object: named(
      "array: an object whose place, turn and size against it each copy steps by.",
    ),
    fit: choice(
      ["count", "length", "curve"],
      "array: count copies, or as many as fill length or curve.",
    ),
    length: amount("array fit length: the length to fill, in metres."),
    curve: named("array: a curve the copies fill and bend along."),
    curve_axis: choice(
      ["x", "y", "z"],
      "array along a curve: its own axis laid along the curve.",
    ),
    merge: {
      type: "number",
      description: "array, mirror: join points this near, in metres.",
    },
    start_cap: named("array: a mesh put at the first copy's end."),
    end_cap: named("array: a mesh put at the last copy's end."),
    around: {
      type: "object",
      description: "array: copies round an axis through a centre.",
      properties: {
        axis: choice(["x", "y", "z"], "The world axis they turn round."),
        centre: vector3("In metres; the object's origin by default."),
        angle: {
          ...amount("The angle the copies span, in degrees."),
          default: 360,
        },
      },
    },
    axes: axes("mirror: axes to mirror across."),
    across: {
      type: "string",
      description: "mirror: an object to mirror around.",
    },
    clip: flag("mirror: false lets points on the mirror move off it."),
    bisect: flag(
      "mirror: false keeps what reaches across the mirror, which then overlaps its copy.",
    ),
    flip: flag(
      "mirror: true keeps each axis's - side, false its + side; left out, the side it mostly lies on.",
    ),
    mirror_u: flag("mirror: the copy's picture layout flipped across u."),
    mirror_v: flag("mirror: the copy's picture layout flipped across v."),
    thickness: {
      type: "number",
      description:
        "solidify: walls this thick, in metres, grown inward so the outside keeps its size.",
    },
    wall_offset: {
      ...amount(
        "solidify: where the wall grows, as a share each side: -1 inward, 0 both ways, 1 outward.",
      ),
      minimum: -1,
      maximum: 1,
      default: -1,
    },
    mode: choice(
      ["simple", "complex"],
      "solidify: complex for a mesh whose edges join more than two faces.",
    ),
    even: flag("solidify: false lets walls thin at slanted corners."),
    rim: flag("solidify: false leaves the open edges' rim unfilled."),
    rim_only: flag("solidify: only the rim, no second shell."),
    shell_group: named(
      "solidify: a vertex group, made when missing, given the new shell's points.",
    ),
    rim_group: named(
      "solidify: a vertex group, made when missing, given the rim's points.",
    ),
    material_offset: count(
      "solidify: the new shell's material slot, this many after each face's own.",
    ),
    rim_material_offset: count(
      "solidify: the rim's material slot, this many after each face's own.",
    ),
    levels: count(
      "subdivision: how many times each face is split, in the view and in renders unless render_levels.",
    ),
    render_levels: count("subdivision: how many times in renders."),
    scheme: choice(
      ["catmull_clark", "simple"],
      "subdivision: catmull_clark rounds the shape; simple only splits its faces.",
    ),
    crease: {
      ...amount(
        "subdivision: how sharp a creased edge stays, 0 smooth, 1 sharp.",
      ),
      ...share,
    },
    edges: {
      type: "string",
      description:
        "subdivision crease: the edges of a pick kept by name with zhiyin.pick, in place of angle.",
    },
    boundary: choice(
      ["smooth_all", "keep_corners"],
      "subdivision: whether the corners of open edges stay sharp.",
    ),
    uv_smooth: choice(
      [
        "none",
        "keep_corners",
        "keep_corners_and_junctions",
        "keep_corners_junctions_and_concave",
        "keep_boundaries",
        "smooth_all",
      ],
      "subdivision: how its picture layout is smoothed with it.",
    ),
    limit_surface: flag(
      "subdivision: false stops short of the limit surface, quicker and less exact.",
    ),
    shading: choice(
      ["by_angle", "smooth", "flat", "mark_sharp"],
      "smooth: by_angle, smooth with edges sharper than angle kept sharp; smooth or flat all over; mark_sharp, those edges marked sharp and the shading kept.",
    ),
    method: choice(
      ["voxel", "quadriflow"],
      "remesh: voxel, an even mesh of voxel_size; quadriflow, quads.",
    ),
    voxel_size: amount("remesh voxel: in metres."),
    adaptivity: {
      ...amount(
        "remesh voxel: how far flat parts merge into larger faces, 0 none, 1 most.",
      ),
      ...share,
      default: 0,
    },
    keep_attributes: flag(
      "remesh voxel: carry the mesh's attributes onto the new one.",
    ),
    faces: count("remesh quadriflow: about how many quads; or edge_length."),
    edge_length: amount("remesh quadriflow: each quad's edge, in metres."),
    keep_sharp: flag(
      "remesh quadriflow, weighted_normals: keep sharp edges sharp.",
    ),
    keep_boundary: flag("remesh quadriflow: keep its open borders."),
    symmetry: axes(
      "remesh quadriflow: axes of its own the result mirrors across.",
    ),
    seed: count("remesh quadriflow: another seed gives another layout."),
    weighting: choice(
      ["face_area", "corner_angle", "both"],
      "weighted_normals: each face's pull by its area, its corners' angles, or both.",
    ),
    weight: count(
      `weighted_normals, hard_surface: how much larger faces outweigh smaller ones, a scale from ${shape.least_weight} to ${shape.most_weight}; at ${shape.weight} by weighting alone.`,
    ),
    face_influence: flag(
      "weighted_normals: weigh by the face strength a bevel gave.",
    ),
    quads: choice(
      ["beauty", "fixed", "alternate", "shortest_diagonal", "longest_diagonal"],
      "triangulate: how each quad is split.",
    ),
    min_vertices: count(
      "triangulate: only faces of at least this many points are split.",
    ),
    keep_normals: flag(
      "triangulate: keep custom normals, so its shading stays.",
    ),
    triangulate: flag("hard_surface: triangulate it last."),
    texture: choice(
      ["clouds", "noise", "voronoi", "image"],
      "displace: the pattern that moves its points; image reads image.",
    ),
    image: workspaceFile("displace: a workspace picture."),
    texture_size: amount("displace: how large its pattern is, in metres."),
    mask: {
      type: "string",
      description:
        "displace: top or sides holds it to the faces facing up or sideways; or a vertex group's name.",
    },
    strength: amount(
      "displace: how far the texture at its brightest moves a point, in metres.",
    ),
    midlevel: {
      ...amount(
        "displace: the texture's value that moves nothing, a share from black to white.",
      ),
      ...share,
      default: 0.5,
    },
    direction: choice(
      ["normal", "x", "y", "z", "custom_normal", "rgb_to_xyz"],
      "displace: the way points move: along their normal, an axis of space, the custom normal, or by the texture's colour.",
    ),
    space: choice(
      ["local", "global"],
      "displace: whether its axes are the object's own or the world's.",
    ),
    target: named("shrinkwrap: the mesh it is wrapped onto."),
    wrap: choice(
      ["nearest_surface", "project", "nearest_vertex", "target_normal"],
      "shrinkwrap: how each point finds the surface: nearest, along project_axes, the nearest vertex, or along the target's normals.",
    ),
    wrap_mode: choice(
      ["on_surface", "outside", "above_surface", "inside", "outside_surface"],
      "shrinkwrap: where a point ends against the surface; none for nearest_vertex.",
    ),
    standoff: amount("shrinkwrap: kept off the surface, in metres."),
    project_axes: axes(
      "shrinkwrap project: axes of its own it projects along; none, its normals.",
    ),
    both_ways: flag(
      "shrinkwrap project: along each axis both ways, not only +.",
    ),
    bevel_mode: choice(
      ["round", "object", "profile"],
      "curve: its section: round of depth, bevel_object's shape, or a profile.",
    ),
    depth: amount("curve: the round section's radius, in metres."),
    resolution: count(
      "curve: how many steps round each quarter of its section.",
    ),
    curve_resolution: count(
      "curve: how many steps between each two of its points.",
    ),
    bevel_object: named("curve: a curve whose shape is its section."),
    profile_preset: choice(
      ["line", "supports", "cornice", "crown", "steps"],
      "curve: a ready section shape.",
    ),
    extrude: amount("curve: how far it is extruded each way, in metres."),
    curve_offset: amount(
      "curve: how far its surface stands off its path, in metres.",
    ),
    taper_object: named(
      "curve: a curve whose height along it scales the section.",
    ),
    taper_mode: choice(
      ["override", "multiply", "add"],
      "curve: how the taper meets each point's own radius.",
    ),
    fill: choice(
      ["full", "back", "front", "half", "both", "none"],
      "curve: which faces are filled: full, back, front or half for a 3D curve; both, back, front or none for a flat one.",
    ),
    caps: flag("curve: close the section's ends."),
    twist: choice(
      ["minimum", "z_up", "tangent"],
      "curve: how its section turns along it.",
    ),
    twist_smooth: amount(
      "curve: how many times its twist is smoothed; 0 for none.",
    ),
    modifier: { type: "string", description: "remove: the step's name." },
  },
  required: ["kind"],
  additionalProperties: false,
};
