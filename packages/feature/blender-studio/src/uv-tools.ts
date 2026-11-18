/**
 * The tools that lay surfaces flat for textures and bake materials into them.
 */

import { objectNames, type StudioTool } from "./schema-parts.js";
import { statedNumbers } from "./stated-numbers.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

const unwrapMethods = [
  "angle",
  "conformal",
  "minimum_stretch",
  "smart",
  "cube",
  "cylinder",
  "sphere",
  "lightmap",
  "follow_quads",
  "camera",
] as const;

const bakeMaps = [
  "color",
  "roughness",
  "metallic",
  "normal",
  "ao",
  "curvature",
  "cavity",
  "thickness",
  "edge",
  "height",
  "emission",
  "opacity",
  "orm",
] as const;

export const uvTools: readonly StudioTool[] = [
  {
    name: "blender_unwrap",
    toolkit: toolkits.unwrap.id,
    label: "Unwrap objects for textures in a 3D scene",
    checksWork: "runs",
    description: `Lay mesh objects' surfaces flat in their UV layout, for pictures and bakes. The seamed methods (angle, conformal, minimum_stretch, follow_quads) cut along seams: by angle and by the boundaries between materials or a CAD part's groups of surfaces, or the mesh's own seams (edges sharper than ${statedNumbers.unwrap.sharp_angle}° when it has none); each closed part is then cut until it lies flat, the cuts hidden where the camera sees least. The projections (smart, cube, cylinder, sphere, lightmap, camera) need no seams. The islands are packed in the tile with margins, filling it or at a texel density. The answer says for each object: islands, angle and area stretch, texel density (over ${statedNumbers.unwrap.density_share}% of the surface), faces turned over, islands overlapping or stacked as mirror twins, how much of the tile they fill and how many reach outside it, and the seams' count, length and share the camera sees. Refuses a mesh with no faces, and seams for a projection. ${timeLimitStated("unwrap")}`,
    inputSchema: {
      type: "object",
      properties: {
        objects: objectNames,
        method: {
          type: "string",
          enum: [...unwrapMethods],
          description:
            "angle (default), conformal, minimum_stretch: unwrap along seams; follow_quads: a grid of quads laid out from its largest; smart: split by angle and projected; cube, cylinder, sphere: projected round the object; lightmap: every face apart; camera: as the scene's camera frames it.",
        },
        seams: {
          type: "object",
          properties: {
            angle: {
              type: "number",
              description: `Seams on edges sharper than this, in degrees; for smart, its angle (${statedNumbers.unwrap.smart_angle} by default).`,
            },
            by: {
              type: "string",
              enum: ["material", "surface_group"],
              description:
                "Seams on the boundaries between materials, or a CAD part's groups of surfaces.",
            },
            hide: {
              type: "boolean",
              description:
                "Run the cuts closed parts need where the camera sees least: true by default when there is a camera.",
            },
          },
          additionalProperties: false,
          description: "Given angle or by, these seams replace the mesh's own.",
        },
        pack: {
          type: "object",
          description: "How the islands are packed in the tile.",
          properties: {
            margin_px: {
              type: "number",
              default: 4,
              description: "Texels between islands.",
            },
            rotate: {
              type: "boolean",
              description: "Turn islands to fit; true by default.",
            },
          },
          additionalProperties: false,
        },
        texel_density: {
          type: "object",
          description: "The texture the islands are scaled and spaced for.",
          properties: {
            px_per_cm: {
              type: "number",
              description:
                "Scale the islands to this many texels per centimetre; without it they fill the tile.",
            },
            resolution: {
              type: "integer",
              default: 1024,
              description:
                "The texture's size in pixels the margins and density are for.",
            },
          },
          additionalProperties: false,
        },
      },
      required: ["objects"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_bake",
    toolkit: toolkits.bake.id,
    label: "Bake materials to textures in a 3D scene",
    checksWork: "runs",
    description: `Bake objects' materials into PNG maps with Cycles, by their UV layouts, and give each object a copy of its material, "<object> baked", drawn from the maps: color, roughness, metallic, normal (tangent, OpenGL), emission, opacity and orm (ao, roughness and metallic in red, green and blue) wired in, height as displacement when no normal map is baked; ao, curvature (lighter on edges that stand out), cavity, edge and thickness (white where thin) as files only. Cycles works the shape maps out within the object's size. With from, the maps come from high-detail objects onto the object (selected to active), the cage set from the measured gap between them. The files are <folder>/<object>_<map>.png. The answer says per map its file, size and value range, and per object the share of texels its layout covers, those rays from the high-detail objects missed, the bleed margin and how near islands come, and shows the maps on one sheet. Refuses an object without a layout (blender_unwrap first), and height without from or a displacement. ${timeLimitStated("bake")}`,
    inputSchema: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description:
            "The objects to bake, each by its name: the files are named after them.",
        },
        maps: {
          type: "array",
          items: { type: "string", enum: [...bakeMaps] },
          minItems: 1,
          uniqueItems: true,
          description: "The maps to bake, each a file of its own.",
        },
        resolution: {
          type: "integer",
          minimum: 32,
          maximum: 8192,
          default: 1024,
          description: "Pixels across each map.",
        },
        margin_px: {
          type: "integer",
          description:
            "Pixels each island's edge bleeds out by; a hundred-and-twenty-eighth of the resolution by default.",
        },
        from: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description:
            "High-detail objects whose surface and materials are baked onto each object.",
        },
        folder: {
          type: "string",
          description:
            "The workspace folder the maps are written in; textures by default.",
        },
      },
      required: ["objects", "maps"],
      additionalProperties: false,
    },
  },
];
