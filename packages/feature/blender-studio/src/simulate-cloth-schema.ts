/** blender_simulate's inputs for cloth, colliders and liquids. */

import { percent, statedNumbers } from "./stated-numbers.js";

const objectNames = { type: "array", items: { type: "string" } } as const;

/** This part's half of blender_simulate's description. */
export const simulateClothDescribed =
  "cloth makes a mesh cloth that meets its colliders and, unless self_collision is false, itself; its pinned points can let go at a time. Its answer gives the grid spacing against the folds formed, when it came to rest, how far it rests off each collider, and whether it stretched, crossed itself or went into a collider. A liquid's gives, before its bake, each obstacle's thinnest wall against the voxel (a leak risk); after, the volume over time, what lies outside the container, the depth in it, bake seconds and cache size. Start at the draft resolution. After a bake, each cloth, soft body and particle system says its top speed against what would mean it blew up, how its box grew, whether it settled, and points left inside a collider; a cloth also says any collider it went through, at which frames and how much of it, and the steps or room that stop it. Detail: open doc:3d-rendering/cloth-and-liquid.";

export const simulateClothProperties = {
  cloth: {
    type: "object",
    description: "A mesh made cloth, or a cloth given again.",
    properties: {
      object: { type: "string", description: "The mesh made cloth." },
      fabric: {
        type: "string",
        enum: ["cotton", "silk", "denim", "leather", "rubber"],
        description: "Blender's preset; cotton by default.",
      },
      pinned: {
        type: "object",
        properties: {
          group: { type: "string", description: "A vertex group of the mesh." },
          edge: {
            type: "string",
            enum: ["top", "bottom", "+x", "-x", "+y", "-y", "border"],
            description:
              "The border's points furthest that way in the world; border, all of them.",
          },
          points: {
            type: "array",
            items: { type: "array", items: { type: "number" } },
            description:
              "[x, y, z] in the world, in metres: the mesh's point nearest each.",
          },
          release: {
            type: "number",
            description:
              "The time in seconds at which the pinned points let go and move freely from then on; held throughout by default.",
          },
        },
        additionalProperties: false,
        description:
          "What is held still, one of: a vertex group, an edge, or the points nearest [x, y, z] points.",
      },
      self_collision: {
        type: "boolean",
        description:
          "Whether it meets itself; on for a new cloth, and a cloth given again without it keeps what it has.",
      },
      pressure: {
        type: "number",
        description:
          "Inflates a closed mesh, as a cushion: a multiple of Blender's pressure scale; negative draws it in.",
      },
      sew: {
        type: "boolean",
        description: "Loose edges pull their ends together.",
      },
      colliders: {
        ...objectNames,
        description: "Meshes it meets, given collision as their last step.",
      },
      subdivide_to: {
        type: "number",
        description: "Grid spacing in metres to subdivide to first.",
      },
      steps: {
        type: "integer",
        description:
          "Steps a frame; the fabric's own by default, more on a fine grid. A fast cloth needs more, so no point moves past a collider in one step; bake time grows in step.",
      },
      drape: {
        type: "boolean",
        description:
          "true: run it until it rests and keep that shape, for stills; else it moves over the scene's frames.",
      },
    },
    required: ["object"],
    additionalProperties: false,
  },
  colliders: {
    type: "object",
    properties: {
      objects: {
        ...objectNames,
        minItems: 1,
        description: "The meshes made colliders, wherever they were made.",
      },
      thickness: {
        type: "number",
        minimum: 0.001,
        description: `Metres kept on each one's outside, the least being the least Blender keeps; ${percent(statedNumbers.simulate.collision_share)} of the finest cloth or soft body spacing by default.`,
      },
    },
    required: ["objects"],
    additionalProperties: false,
    description:
      "Objects every cloth, soft body and particle system meets, their collision placed after every step that deforms them.",
  },
  liquid: {
    type: "object",
    description:
      "A Mantaflow liquid, baked in a domain made round the container and sources.",
    properties: {
      container: {
        type: "string",
        description: "The mesh that holds the liquid, an obstacle too.",
      },
      sources: {
        type: "array",
        minItems: 1,
        description: "Where the liquid comes from.",
        items: {
          type: "object",
          properties: {
            object: { type: "string", description: "A mesh." },
            flow: {
              type: "string",
              enum: ["shape", "pour"],
              description:
                "shape (default): its volume starts as liquid; pour: liquid flows in from it every frame.",
            },
            speed: {
              type: "array",
              items: { type: "number" },
              description: "Starting velocity, m/s.",
            },
          },
          required: ["object"],
          additionalProperties: false,
        },
      },
      obstacles: {
        ...objectNames,
        description: "Meshes it flows round.",
      },
      preset: {
        type: "string",
        enum: ["water", "oil", "honey"],
        description: "How thick it flows.",
      },
      resolution: {
        type: "integer",
        minimum: 8,
        maximum: 256,
        default: 32,
        description:
          "How many voxels along the domain's longest side; the default makes a draft.",
      },
      voxel: { type: "number", description: "Or the voxel size in metres." },
    },
    required: ["sources"],
    additionalProperties: false,
  },
} as const;
