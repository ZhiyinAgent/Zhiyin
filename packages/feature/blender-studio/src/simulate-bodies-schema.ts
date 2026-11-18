/** blender_simulate's inputs for rigid bodies, settling, keys and baking. */

import { vector3 } from "./schema-parts.js";

/** This part's half of the tool's description. */
export const simulateBodiesDescribed =
  "Rigid bodies: rigid gives groups of objects to Blender's rigid-body physics, active (falls and is pushed, weighed as its measured volume times a density or a material's, or by a mass), passive (held still) or animated (moved by its own keys, pushing what it meets). Bodies starting inside each other, or inside another's convex collision shape, are refused with how deep. The world runs over the scene's timeline; the answer gives each body's mass, and for each active one when it comes to rest, its top speed, what it rests on and where it is, or that it is still moving at the end. bake true bakes every simulation in the scene over the timeline in order (rigid bodies, cloth and soft bodies, particles, dynamic paint, liquids, geometry nodes simulation zones), each with its frames, seconds, cache size or why it failed, and a zone's point count and whether its state stays finite. In detail: open doc:3d-rendering/physics.";

export const simulateBodyProperties = {
  rigid: {
    type: "array",
    description: "Groups of objects given to the rigid-body physics.",
    items: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "The objects, or /patterns/.",
        },
        role: {
          type: "string",
          enum: ["active", "passive", "animated"],
          description: "active by default.",
        },
        shape: {
          type: "string",
          enum: [
            "hull",
            "mesh",
            "box",
            "sphere",
            "cylinder",
            "capsule",
            "cone",
          ],
          description:
            "The collision shape: by default hull, and for a passive body that is not convex mesh. Give mesh for anything hollow.",
        },
        density: { type: "number", description: "kg/m³." },
        material: {
          type: "string",
          description:
            "A material of Blender's table, such as Steel or Timber.",
        },
        mass: { type: "number", description: "kg." },
        friction: {
          type: "number",
          minimum: 0,
          maximum: 100,
          default: 0.5,
          description:
            "How it resists sliding, a ratio of forces: 0 slides freely.",
        },
        bounce: {
          type: "number",
          minimum: 0,
          maximum: 1,
          default: 0,
          description: "0 stays where it lands, 1 bounces back fully.",
        },
      },
      required: ["objects"],
      additionalProperties: false,
    },
  },
  world: {
    type: "object",
    description: "The rigid-body world's gravity and how finely it is solved.",
    properties: {
      gravity: { ...vector3("m/s²."), default: [0, 0, -9.81] },
      substeps: {
        type: "integer",
        default: 10,
        description: "How many steps it is solved in each frame.",
      },
      iterations: {
        type: "integer",
        default: 10,
        description: "How many times the solver works each step.",
      },
    },
    additionalProperties: false,
  },
  bake: {
    type: "boolean",
    description: "true bakes every simulation; false frees every bake.",
  },
  then: {
    type: "string",
    enum: ["settle", "to_keys"],
    description:
      "settle keeps the rigid bodies where they are at the end as plain places, for stills; to_keys keys their motion, for animation and export; both remove the rigid-body physics.",
  },
} as const;
