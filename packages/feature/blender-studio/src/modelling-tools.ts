/**
 * The tools that make and place the open scene's objects: adding them,
 * editing, copying and setting them out, settling them with physics, and
 * shaping them. Sizes and positions are in metres and angles in degrees; an
 * object's location is its origin.
 */

import {
  point2,
  vector3,
  workspaceFile,
  type StudioTool,
} from "./schema-parts.js";
import { shapeStep } from "./shape-schema.js";
import { statedNumbers } from "./stated-numbers.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

const flying = {
  type: "boolean",
  description: "Meant to stay aloft, as a bird: never said to float.",
};

const objectSpec = {
  type: "object",
  properties: {
    name: { type: "string", description: "A new, unique name." },
    kind: {
      type: "string",
      enum: [
        "cube",
        "cylinder",
        "cone",
        "sphere",
        "icosphere",
        "quad_sphere",
        "plane",
        "grid",
        "circle",
        "torus",
        "monkey",
        "revolve",
        "outline",
        "tube",
        "text",
        "image",
        "svg",
        "model",
        "instance",
      ],
      description:
        "cube, cylinder ([diameter, diameter, height]), cone, sphere (UV), icosphere, quad_sphere, plane, grid and circle ([x, y]), torus, monkey; revolve: a profile turned round the vertical axis; outline: flat corners with holes, extruded; tube: along points; text; image: a workspace picture on a plane; svg: a workspace drawing; model: a workspace model file; instance: of a collection or object.",
    },
    size: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 3,
      description:
        "Width, depth, height in metres, along the object's own axes before it is turned. For a model, the box it is scaled to fit.",
    },
    location: {
      ...vector3("Where the object's origin goes, in metres."),
      default: [0, 0, 0],
    },
    rest_on: {
      type: "string",
      description:
        "“floor” (a Floor or Ground object under it, else z 0), “below” (whatever is under it), or an object to set this one down on, lowered straight onto it to the first surface below; its location gives where across.",
    },
    rest_across: {
      type: "array",
      items: { type: "string" },
      description:
        "Several objects to set this one down across, as a plank on two trestles: it lands on the first it meets.",
    },
    align_to_surface: {
      type: "boolean",
      description:
        "With rest_on: tilt it to follow the surface it lands on, as a rock on a slope.",
    },
    of: {
      type: "string",
      description: "instance: the collection or object it places.",
    },
    flying,
    rotation: vector3("Rotation around x, y and z, in degrees."),
    parent: { type: "string", description: "An object this one moves with." },
    smooth: {
      type: "boolean",
      description:
        "Smooth shading that keeps sharp edges crisp: on by default for round shapes, false for flat faces; true shades every part of a model file.",
    },
    bevel: {
      type: "object",
      properties: {
        width: {
          type: "number",
          description: "In metres, at most half the object's thinnest side.",
        },
        segments: {
          type: "integer",
          description: "How many faces across each rounded edge.",
        },
      },
      required: ["width"],
      description: "Rounded edges.",
    },
    segments: {
      type: "integer",
      description: `How many sides round (${statedNumbers.add.segments} by default); a circle's points, a grid's columns, a quad sphere's quads along each edge.`,
    },
    rings: {
      type: "integer",
      description:
        "sphere: how many rings pole to pole; torus: sides round its tube.",
    },
    rows: { type: "integer", description: "grid: how many rows of faces." },
    subdivisions: {
      type: "integer",
      minimum: 1,
      maximum: 8,
      default: 3,
      description: "icosphere: how many times its faces are split.",
    },
    fill: {
      type: "string",
      enum: ["none", "ngon", "fan"],
      description:
        "circle: none, its outline alone; ngon, one face; fan, triangles round its middle.",
    },
    section: {
      type: "array",
      items: point2,
      description:
        "tube: [x, y] corners of its cross-section in metres, in place of a radius.",
    },
    taper: {
      ...point2,
      description:
        "tube: its width at its start and end, as shares of its radius.",
    },
    caps: { type: "boolean", description: "tube: false leaves its ends open." },
    top_ratio: {
      type: "number",
      minimum: 0,
      maximum: 1,
      default: 0,
      description: "cone: the top diameter as a share of the bottom one.",
    },
    diameter: {
      type: "number",
      description: "torus: outer diameter in metres.",
    },
    thickness: {
      type: "number",
      description: "torus: thickness of the ring in metres.",
    },
    profile: {
      type: "array",
      items: point2,
      description:
        "revolve: [radius, height] points in metres along the cross-section. On the axis at both ends it is closed; up the outside and back down the inside makes walls; touching the axis at neither end it is a solid ring, its last point joined to its first.",
    },
    points: {
      type: "array",
      items: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 3,
      },
      description:
        "outline: [x, y] corners in metres. tube: [x, y, z] points in metres.",
    },
    holes: {
      type: "array",
      items: { type: "array", items: point2 },
      description:
        "outline: inner outlines of [x, y] corners in metres, cut out of it.",
    },
    height: {
      type: "number",
      description: "outline: extrusion height. text: letter height. In metres.",
    },
    radius: { type: "number", description: "tube: radius in metres." },
    corners: {
      type: "string",
      enum: ["round", "sharp"],
      description:
        "tube: round (default) is a smooth curve through every point, for handles and cables; sharp joins the points with straight runs, for pipes.",
    },
    closed: {
      type: "boolean",
      description:
        "tube: join the last point to the first. revolve: false leaves a profile touching the axis at neither end an open sheet.",
    },
    text: {
      type: "string",
      description:
        "text: the words. Chinese, Japanese and Korean get a font that has them.",
    },
    depth: { type: "number", description: "text, svg: thickness in metres." },
    wrap_radius: {
      type: "number",
      description:
        "text: bends the line round a round surface of this radius in metres, as lettering lies on a jar; for a jar at the origin, rotation [90, 0, 0] and location [0, -radius, height].",
    },
    font: workspaceFile(
      "text: a .ttf, .otf or .ttc font in the workspace, or a font file name from Windows' Fonts folder.",
    ),
    width: {
      type: "number",
      description:
        "image, svg: width in metres; the height follows its proportions.",
    },
    path: workspaceFile("image, svg, model: the workspace file to use."),
  },
  required: ["name", "kind"],
  additionalProperties: false,
};

export const modellingTools: readonly StudioTool[] = [
  {
    name: "blender_add_objects",
    label: "Add objects to a 3D scene",
    checksWork: "runs",
    toolkit: toolkits.modelling.id,
    description: `Add objects to the open scene: solids, rings, turned profiles, extruded outlines with holes, tubes, 3D text, pictures on planes, SVG drawings, model files, or instances of a collection or object, which share its meshes. Sizes are in metres with z up; the front looks from -y toward +y. An object's location is where its origin goes: solids, text, pictures and drawings are centred on it, while a shape drawn through points and a model file keep the coordinates they were drawn or made in round it, so a CAD part lands where it was designed. Flat kinds lie facing up; rotation [90, 0, 0] stands one up facing the front. An input a kind does not take is refused. The answer gives each object's own size, its turn, where its bottom and top are, and what it goes into. Each kind in detail: open doc:3d-rendering/objects. ${timeLimitStated("add")}`,
    inputSchema: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          items: objectSpec,
          minItems: 1,
          description:
            "Made in order: one may rest on or attach to one listed before it.",
        },
      },
      required: ["objects"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_edit_objects",
    toolkit: toolkits.modelling.id,
    label: "Change objects in a 3D scene",
    checksWork: "runs",
    description: `Move, turn, resize, rename, attach, hide, duplicate, set out along a path, set down on the floor or on other objects, or delete objects. Positions and turns are the world's, for attached parts too; turning and resizing happen around the object's origin, and turn_about turns it round another point, as a door on its hinge. A size is the object's own, along its own axes. Copying, hiding or deleting an object does the same to what is attached to it, holes included. Copies go a step apart or round an axis, and linked copies share one mesh. against pushes it along an axis until it meets another's side, and to lays a point of it on a point of another's shape; each says the gap measured after, 0 mm when they touch. The answer says where each moved object's bottom and top are, what it rests on, and what it goes into. Setting down, turning, copies and rows in detail: open doc:3d-rendering/placing. ${timeLimitStated("edit")}`,
    inputSchema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          minItems: 1,
          description: "Done in order, each to one object.",
          items: {
            type: "object",
            properties: {
              object: {
                type: "string",
                description: "Its exact name; no pattern.",
              },
              location: vector3("Where the origin goes, in metres."),
              move_by: vector3("Move by this much, in metres."),
              rotation: vector3("New rotation in degrees."),
              size: vector3("New size in metres."),
              scale: vector3(
                "Multiples of its built size along its own axes; 1 is as built.",
              ),
              rename: {
                type: "string",
                description: "A new name no object has.",
              },
              parent: {
                type: "string",
                description: "An object this one moves with from now on.",
              },
              detach: {
                type: "boolean",
                description: "Stop moving with the object it is attached to.",
              },
              hidden: {
                type: "boolean",
                description:
                  "Hidden from the view and pictures, with what is attached; false shows it.",
              },
              turn_about: {
                type: "object",
                description:
                  "Turn it round an axis through a point or another object's origin, as a door on its hinge: it moves as it turns.",
                properties: {
                  point: vector3("The point it turns round, in metres."),
                  object: {
                    type: "string",
                    description: "An object whose origin it turns round.",
                  },
                  axis: {
                    type: "string",
                    enum: ["x", "y", "z"],
                    description: "The world axis it turns round; z by default.",
                  },
                  angle: { type: "number", description: "In degrees." },
                },
                required: ["angle"],
              },
              rest_on: {
                type: "string",
                description:
                  "“floor” (a Floor or Ground object under it, else z 0), “below” (whatever is under it), or an object to set this one down on, as if lowered straight onto it: it lands on the first surface below.",
              },
              rest_across: {
                type: "array",
                items: { type: "string" },
                description:
                  "Several objects to set it down across, as a plank on two trestles: it lands on the first it meets.",
              },
              align_to_surface: {
                type: "boolean",
                description:
                  "With rest_on or rest_across: tilt it to follow the surface it lands on, as a rock on a slope.",
              },
              duplicate: {
                type: "object",
                description:
                  "Copies, each an offset further on, or turned round an axis: evenly round a full turn, or across the angle given.",
                properties: {
                  count: {
                    type: "integer",
                    description: "How many copies, the original not counted.",
                  },
                  offset: vector3("Step between copies, in metres."),
                  around: {
                    type: "object",
                    description: "Instead of offset: an axis they turn round.",
                    properties: {
                      point: vector3("The point they turn round, in metres."),
                      object: {
                        type: "string",
                        description: "An object whose origin they turn round.",
                      },
                      axis: {
                        type: "string",
                        enum: ["x", "y", "z"],
                        description: "The world axis they turn round.",
                      },
                      angle: {
                        type: "number",
                        default: 360,
                        description:
                          "Degrees the copies spread across, the original among them.",
                      },
                    },
                  },
                  linked: {
                    type: "boolean",
                    description:
                      "The copies share its mesh: one mesh in memory however many there are. Resizing a copy gives it its own.",
                  },
                },
              },
              distribute: {
                type: "object",
                description:
                  "Set it out with copies of it, or with the objects listed in with, along a line, a circle, a curve object or points.",
                properties: {
                  count: {
                    type: "integer",
                    description: "How many in all, it included.",
                  },
                  with: {
                    type: "array",
                    items: { type: "string" },
                    description: "Objects set out after it, in order.",
                  },
                  along: {
                    type: "object",
                    description: "One of line, circle, curve or points.",
                    properties: {
                      line: {
                        type: "array",
                        items: { type: "array", items: { type: "number" } },
                        description: "[from, to], two points in metres.",
                      },
                      circle: {
                        type: "object",
                        description: "A circle or an arc.",
                        properties: {
                          centre: vector3("In metres."),
                          radius: { type: "number", description: "In metres." },
                          axis: {
                            type: "string",
                            enum: ["x", "y", "z"],
                            description: "The world axis it lies round.",
                          },
                          start: {
                            type: "number",
                            description:
                              "Degrees from +x where the first goes.",
                          },
                          angle: {
                            type: "number",
                            default: 360,
                            description: "Degrees of an arc.",
                          },
                        },
                        required: ["radius"],
                      },
                      curve: {
                        type: "string",
                        description: "A curve object to follow.",
                      },
                      points: {
                        type: "array",
                        items: { type: "array", items: { type: "number" } },
                        description:
                          "[x, y, z] points in metres, one for each: count is theirs.",
                      },
                    },
                  },
                  spacing: {
                    type: "string",
                    enum: ["centres", "gaps"],
                    description:
                      "centres: origins evenly apart (default); gaps: even clear gaps between them, the first and last at the path's ends.",
                  },
                  apart: {
                    type: "number",
                    description:
                      "Origins exactly this far apart along the path, in metres.",
                  },
                  face: {
                    type: "string",
                    enum: ["none", "along", "centre"],
                    description:
                      "Turn each about z: along, its +x following the path; centre, its front facing the circle's middle.",
                  },
                  rest_on: {
                    type: "string",
                    description:
                      "Set each down afterwards: “floor”, “below” or an object.",
                  },
                  linked: {
                    type: "boolean",
                    description: "The copies share its mesh.",
                  },
                },
                required: ["along"],
              },
              against: {
                type: "object",
                description:
                  "Push it along one axis against a side of another object until their surfaces meet, or stand gap apart, keeping where it is across: a bookcase against a wall, a crate against another.",
                properties: {
                  object: {
                    type: "string",
                    description: "The other, not one attached to it.",
                  },
                  side: {
                    type: "string",
                    enum: ["left", "right", "front", "back", "top", "bottom"],
                    description:
                      "The other's side it ends against: left -x, right +x, front -y, back +y, top +z, bottom -z.",
                  },
                  gap: {
                    type: "number",
                    default: 0,
                    description: "The gap left, in metres.",
                  },
                },
                required: ["object", "side"],
                additionalProperties: false,
              },
              to: {
                type: "object",
                description:
                  "Move it so a point of it lies on a point of another's shape: its bottom-centre on a table's top-centre, its back-centre on a wall's nearest surface.",
                properties: {
                  object: {
                    type: "string",
                    description: "The other, not one attached to it.",
                  },
                  point: {
                    type: "string",
                    enum: [
                      "top-centre",
                      "nearest-surface",
                      "nearest-vertex",
                      "edge-midpoint",
                      "face-centre",
                    ],
                    description:
                      "The other's point: top-centre where a ray down its middle meets it; the rest nearest this one's point.",
                  },
                  by: {
                    type: "string",
                    enum: [
                      "bottom-centre",
                      "top-centre",
                      "centre",
                      "front-centre",
                      "back-centre",
                      "left-centre",
                      "right-centre",
                      "origin",
                    ],
                    description:
                      "The point of this one, by its box in the world, or its origin; bottom-centre by default.",
                  },
                },
                required: ["object", "point"],
                additionalProperties: false,
              },
              flying,
              delete: {
                type: "boolean",
                description:
                  "Remove it and what is attached; the edit's other inputs are not done.",
              },
              shapes_from: {
                type: "string",
                description:
                  "A workspace model file, such as a CAD export made again after a change: the object and each part of it take the shape of the part of the same name in the file, about the origin the file gives it, keeping their place, turn, attachments, materials and motion. Parts the file lacks keep their shapes; parts it adds are named, for blender_add_objects.",
              },
            },
            required: ["object"],
            additionalProperties: false,
          },
        },
      },
      required: ["edits"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_settle_objects",
    toolkit: toolkits.modelling.id,
    label: "Settle objects with physics in a 3D scene",
    checksWork: "runs",
    description: `Drop objects onto what they rest on with Blender's rigid-body physics, so a pile or a tumbled stone lands as gravity leaves it, then keep where each settled as its plain place and take the physics away. Each dropped object must be free: not attached to another, and not moving by keys. The answer says for each how far it fell and turned, what it rests on, whether it was still moving at the end, and whether it fell off. In detail: open doc:3d-rendering/placing. ${timeLimitStated("settle")}`,
    inputSchema: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "The objects to drop, where they are now.",
        },
        on: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description:
            "What they settle onto and against, held still: a floor, a table, a bowl.",
        },
        seconds: {
          type: "number",
          minimum: 0.2,
          maximum: 20,
          default: 3,
          description: "Seconds the physics runs before each place is kept.",
        },
        shape: {
          type: "string",
          enum: ["hull", "mesh", "box"],
          description:
            "How the physics sees each dropped object: hull (its convex outline, default), mesh (exact, slower, for hollow things), box.",
        },
        friction: {
          type: "number",
          minimum: 0,
          maximum: 1,
          default: 0.5,
          description:
            "Of every body, dropped and held: 0 slides freely, 1 grips most.",
        },
        bounce: {
          type: "number",
          minimum: 0,
          maximum: 1,
          default: 0,
          description: "Of every body: 0 lands dead, 1 bounces back fully.",
        },
      },
      required: ["objects", "on"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_shape_objects",
    toolkit: toolkits.modelling.id,
    label: "Model an object in a 3D scene",
    checksWork: "runs",
    description: `Model a mesh object: cut holes or shapes out of it, join or intersect it with others, round its edges, repeat it in rows, round an axis or along a curve, mirror, give it wall thickness, subdivide, shade it smooth, flat or by angle, weight its normals, triangulate, remesh it by voxels or QuadriFlow, displace it by a texture, wrap it onto another object; or set a curve object's geometry. Each step but a remesh stays editable unless applied; a remesh bakes the steps before it. To make a hole, use a boolean difference with a cutter described in the call, or with an object already in the scene, which is then hidden. A mirror keeps the side of the mirror the object mostly lies on and cuts away what reaches across, so it never overlaps itself. Each step's answer is measured: edges rounded, gaps between copies, seams on a mirror, wall thickness, how far a subdivision or remesh strays from the shape before, what a wrap leaves off the surface. An input a kind does not take is refused, and a CAD part's shape is changed in the CAD. Every kind and input: open doc:3d-rendering/shaping. ${timeLimitStated("shape")}`,
    inputSchema: {
      type: "object",
      properties: {
        object: {
          type: "string",
          description: "A mesh, or a curve for a curve step.",
        },
        operations: {
          type: "array",
          minItems: 1,
          items: shapeStep,
          description:
            "Steps added in order, each on what the ones before made.",
        },
        apply: {
          type: "boolean",
          description:
            "Bake every step into the mesh. Cutters nothing else uses are removed.",
        },
      },
      required: ["object", "operations"],
      additionalProperties: false,
    },
  },
];
