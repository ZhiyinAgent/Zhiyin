/**
 * blender_animate's inputs for rigs and drivers: values driven live by
 * others, and poses saved on an armature by name, to key by name.
 */

import { longestFormula } from "./motion-limits.js";
import { vector3 } from "./schema-parts.js";

/** One value a driver reads: a value of an object or bone, or the distance or turn between two. */
const driveVariable = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Its name in the formula; a, b, c… in order by default.",
    },
    kind: {
      type: "string",
      enum: ["value", "distance", "turn_between"],
      description:
        "value (default) reads path; distance and turn_between measure from object or bone to to or to_bone.",
    },
    object: { type: "string", description: "The object it reads." },
    bone: {
      type: "string",
      description: "A bone of object, read or measured from instead.",
    },
    path: {
      type: "string",
      description: "value: the path read from object or bone, as location[2].",
    },
    to: {
      type: "string",
      description: "distance, turn_between: the object measured to.",
    },
    to_bone: {
      type: "string",
      description: "A bone of to, measured to instead.",
    },
  },
  required: ["object"],
  additionalProperties: false,
};

export const driveSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      object: {
        type: "string",
        description: "The object whose value is driven.",
      },
      path: {
        type: "string",
        description:
          'The value driven, by its path from the object: pose.bones["Jaw"].rotation_euler[0], data.shape_keys.key_blocks["Smile"].value, modifiers["Bend"].angle, ["open"].',
      },
      variables: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: driveVariable,
        description: "The values it is worked out from.",
      },
      combine: {
        type: "string",
        enum: ["average", "sum", "min", "max"],
        description: "average by default.",
      },
      formula: {
        type: "string",
        maxLength: longestFormula,
        description: `Instead of combine: arithmetic of the names, as follow's formula. At most ${longestFormula} characters.`,
      },
    },
    required: ["object", "path", "variables"],
    additionalProperties: false,
  },
  description:
    "Values driven live by others, which Blender works out without Python; angles in degrees.",
};

export const posesSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      object: { type: "string", description: "The armature." },
      name: {
        type: "string",
        description: "The name a key's pose gives; saved again, replaced.",
      },
      bones: {
        type: "array",
        description: "Each bone's turn and move from its rest.",
        items: {
          type: "object",
          properties: {
            bone: { type: "string", description: "A bone of the armature." },
            rotation: vector3("Degrees about its own axes."),
            location: vector3("Metres along them."),
          },
          required: ["bone"],
          additionalProperties: false,
        },
      },
    },
    required: ["object", "name"],
    additionalProperties: false,
  },
  description:
    "Poses saved on an armature by name, to key by name; without bones, its pose now.",
};
