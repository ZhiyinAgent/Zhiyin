/**
 * The tool that gives objects materials: colour, metal and roughness, a
 * finish drawn at its real size, wear and grime, glass, glow, pictures and
 * surface detail.
 */

import { finishProperties } from "./finish-schema.js";
import { toonShading } from "./look-schema.js";
import {
  colour,
  objectNames,
  point2,
  vector3,
  workspaceFile,
  type StudioTool,
} from "./schema-parts.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

const projections = {
  type: "string",
  enum: ["uv", "box", "cylinder", "sphere", "front"],
};
const pictureMap = {
  type: "object",
  properties: {
    path: workspaceFile("A picture in the workspace."),
    projection: {
      ...projections,
      description:
        "How the picture wraps: cylinder around a can or bottle, box on all sides, front from the front, uv along the shape's own layout.",
    },
    repeat: {
      ...point2,
      description: "How many times it repeats across and up.",
    },
    use_alpha: {
      type: "boolean",
      description: "Use the picture's transparency.",
    },
  },
  required: ["path"],
  additionalProperties: false,
};
/** Where a map lies, as the texture's inputs say. */
const laying = {
  projection: { ...projections, description: "How it wraps, as a texture's." },
  repeat: {
    ...point2,
    description: "How many times it repeats across and up.",
  },
};

const rgb = {
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
};
const convention = {
  type: "string",
  enum: ["opengl", "directx"],
  description:
    "opengl, Blender's own, or directx, its green flipped; guessed from the file's name when left out.",
};
/** A value held from 0 to 1. */
const share = { type: "number", minimum: 0, maximum: 1 };
const size = {
  type: "number",
  description: "Metres one repeat covers, instead of repeat.",
};
/** The pictures of a texture set, each named in place of the folder's. */
const setPictures = {
  color: "The base colour picture.",
  roughness: "The roughness picture.",
  metallic: "The metalness picture.",
  normal: "The normal map.",
  height: "The height picture, which height draws.",
  ao: "Read and left out: Cycles and EEVEE shade crevices themselves.",
  opacity: "The opacity picture.",
  orm: "Occlusion, roughness and metalness in red, green and blue.",
};

export const surfacingTools: readonly StudioTool[] = [
  {
    name: "blender_set_material",
    toolkit: toolkits.surfacing.id,
    label: "Set a material in a 3D scene",
    checksWork: "runs",
    description: `Give objects, or some of their faces, a material: colour, metal, roughness, a coat, a finish such as cast aluminium, paint or rubber, wood, wear and grime, glass and its tint, light inside, glow, transparency, a picture, a texture set or relief; toon shading in flat bands. A call naming a material that exists changes only the values it gives and keeps the rest, and the answer says what changed; a finish given brings its own colour, metal, roughness and coat unless the call gives them too. A new name makes a new material, with the defaults for what is not given. Naming an existing material with nothing else puts it on as it is. blender_describe_scene lists each material's values. In detail: open doc:3d-rendering/materials. ${timeLimitStated("material")}`,
    inputSchema: {
      type: "object",
      properties: {
        objects: objectNames,
        material: {
          type: "object",
          description:
            "The material: one that exists changes only the values given.",
          properties: {
            name: {
              type: "string",
              description:
                "Changes the material of that name, keeping what the call does not give, or makes one.",
            },
            color: colour("Base colour, like #c0392b."),
            metallic: { ...share, description: "0 not metal, 1 metal." },
            ...finishProperties,
            roughness: { ...share, description: "0 mirror, 1 matte." },
            transmission: {
              ...share,
              description:
                "The share of light that passes through: 1 for glass, clear plastic and liquids, the colour filtering it.",
            },
            ior: {
              type: "number",
              description:
                "Index of refraction, a ratio: 1.45 glass, 1.33 water.",
            },
            alpha: {
              ...share,
              description:
                "Opacity, 0 unseen, 1 solid: for cut-outs and thin see-through films; glass and liquids use transmission.",
            },
            emission: {
              type: "object",
              description: "Light the surface gives off.",
              properties: {
                color: colour(
                  "Glow colour. Left out on a material with a texture, the picture is what glows, as on a screen.",
                ),
                strength: {
                  type: "number",
                  description:
                    "A multiple: 1 shows its colour as given, more lights what is round it.",
                },
                kelvin: {
                  type: "number",
                  description:
                    "Colour temperature in kelvin, times its colour; not with a picture's glow.",
                },
                lights_scene: {
                  type: "boolean",
                  description: "false: Cycles samples it as no light.",
                },
              },
            },
            specular: {
              ...share,
              default: 0.5,
              description:
                "How strongly a non-metal reflects, a scale: the default is what its ior gives, lower reflects less, 0 not at all.",
            },
            coat: {
              ...share,
              description:
                "A clear glossy layer on top, 0 none, 1 full: as on glazed ceramic or lacquer.",
            },
            coat_roughness: {
              ...share,
              default: 0.03,
              description:
                "How blurred the coat's reflections are, 0 sharp, 1 matte; the default is glassy.",
            },
            coat_tint: colour("The coat's colour, as candy paint."),
            coat_ior: {
              type: "number",
              description: "The coat's index of refraction, a ratio.",
            },
            specular_tint: colour("Tints reflections; on a metal, its edges."),
            diffuse_roughness: {
              ...share,
              description:
                "0 smooth, 1 as chalk, clay or cloth scatter light. Cycles only.",
            },
            distribution: {
              type: "string",
              enum: ["multiscatter-ggx", "ggx"],
              description:
                "How reflections spread: ggx loses some of the light a rough surface reflects.",
            },
            subsurface: {
              type: "object",
              description: "Light scattered inside, as skin, wax and marble.",
              properties: {
                preset: {
                  type: "string",
                  enum: [
                    "skin",
                    "wax",
                    "marble",
                    "jade",
                    "milk",
                    "egg",
                    "fruit",
                  ],
                  description:
                    "A starting point: its colour, reach and method, measured or judged by eye.",
                },
                weight: {
                  type: "number",
                  description: "The share of light that scatters inside.",
                },
                radius_mm: {
                  ...rgb,
                  description: "mm in red, green, blue.",
                },
                scale: { type: "number", description: "× radius_mm." },
                method: {
                  type: "string",
                  enum: ["burley", "random-walk", "random-walk-skin"],
                  description: "How Cycles works it out.",
                },
                anisotropy: {
                  type: "number",
                  description: "-1 scatters back, 0 evenly, 1 onward.",
                },
              },
              additionalProperties: false,
            },
            tint: {
              type: "object",
              description:
                "With transmission: the colour seen through depth metres.",
              properties: {
                color: colour("The colour seen through depth."),
                depth: { type: "number", description: "In metres." },
              },
              required: ["color", "depth"],
              additionalProperties: false,
            },
            texture: {
              ...pictureMap,
              description: "A picture as the base colour, such as a label.",
            },
            normal_map: {
              type: "object",
              description: "A normal map for surface detail.",
              properties: {
                path: workspaceFile("A normal map in the workspace."),
                ...laying,
                strength: {
                  type: "number",
                  description: "A multiple of its relief, 1 as drawn.",
                },
                convention,
              },
              required: ["path"],
              additionalProperties: false,
            },
            maps: {
              type: "object",
              description: "A texture set: a folder, or its pictures named.",
              properties: {
                folder: {
                  type: "string",
                  description:
                    "A workspace folder whose pictures are sorted by the word each name ends with (Color, NormalGL…); a picture named here is used over its kind's.",
                },
                ...Object.fromEntries(
                  Object.entries(setPictures).map(([kind, description]) => [
                    kind,
                    { type: "string", description },
                  ]),
                ),
                size,
                ...laying,
                convention,
                strength: {
                  type: "number",
                  description:
                    "A multiple of the normal map's relief, 1 as drawn.",
                },
              },
              additionalProperties: false,
            },
            height: {
              type: "object",
              description:
                "Relief rising up to depth metres from a picture, a pattern or the maps' height.",
              properties: {
                path: workspaceFile("A height picture in the workspace."),
                pattern: {
                  type: "object",
                  description: "Instead of a picture.",
                  properties: {
                    kind: {
                      type: "string",
                      enum: ["noise", "cells"],
                      description: "noise, uneven; cells, dimpled cells.",
                    },
                    size: {
                      type: "number",
                      description: "How wide its features are, in metres.",
                    },
                  },
                  required: ["kind", "size"],
                  additionalProperties: false,
                },
                depth: {
                  type: "number",
                  description: "How far its highest point rises, in metres.",
                },
                method: {
                  type: "string",
                  enum: ["bump", "displace", "both"],
                  description:
                    "bump: the light shows it, the outline does not; displace moves the surface; both, with bump for what is finer.",
                },
                size,
                ...laying,
              },
              required: ["depth"],
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        surface: {
          type: "string",
          description:
            "One group of a CAD part's surfaces, as blender_describe_scene lists them; rest is its other faces.",
        },
        faces: {
          type: "object",
          description:
            "Only the faces meeting every condition: facing a direction within degrees, inside a world box, marked by a face attribute or kept pick, or showing a material.",
          properties: {
            facing: vector3(
              "A direction in the world: faces whose outward normal is within `within` of it.",
            ),
            within: {
              type: "number",
              description: "Degrees a face may lean from facing.",
            },
            inside: {
              type: "array",
              items: vector3("[x, y, z] in metres."),
              minItems: 2,
              maxItems: 2,
              description:
                "Two opposite corners of a box in the world, in metres: faces whose middle is in it.",
            },
            attribute: {
              type: "string",
              description:
                "A face attribute or a kept pick: faces where it is true or not 0.",
            },
            slot: {
              type: "string",
              description: "A material the faces show now, by name.",
            },
          },
          additionalProperties: false,
        },
        ...toonShading,
      },
      required: ["objects", "material"],
      additionalProperties: false,
    },
  },
];
