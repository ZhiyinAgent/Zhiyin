/** blender_rig's inputs for binding a mesh to its bones and limbs that reach. */

import { statedNumbers } from "./stated-numbers.js";

const rig = statedNumbers.rig;

/** blender_rig's description, for binding and reaching limbs. */
export const rigBindDescribed = `bind puts meshes on an armature's deforming bones with an Armature step, and answers points with no weight, points on more than ${rig.engine_most} bones, bones that move nothing, and a pose test: each joint turned ${rig.pose_turn}° each way, with the volume it loses near the joint and new places where the surface goes through itself. ik makes a chain of bones reach for a target, its bend kept toward a pole, or lie along a curve; it answers, over the timeline, where the tip falls short, where the bend flips side and where bones stretch. Binding and reaching in detail: open doc:3d-rendering/binding.`;

export const rigBindProperties = {
  bind: {
    type: "object",
    description: "Bind meshes to the armature's deforming bones.",
    properties: {
      meshes: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "The meshes to bind.",
      },
      armature: {
        type: "string",
        description:
          "By default the rig this call made or fitted to one of the meshes, else the scene's only armature.",
      },
      how: {
        type: "string",
        enum: ["automatic", "envelope", "rigid"],
        description:
          "automatic (default): weights by heat from each bone; envelope: by each bone's envelope; rigid: each loose part whole to the bone it lies in, as a robot's.",
      },
      preserve_volume: {
        type: "boolean",
        description:
          "Bend by dual quaternions, so joints keep their thickness; true by default.",
      },
      influences: {
        type: "integer",
        minimum: 1,
        maximum: 16,
        description: `Keep at most this many bones on each point, the heaviest, their weights summing to 1; ${rig.engine_most} for a game engine.`,
      },
    },
    required: ["meshes"],
    additionalProperties: false,
  },
  ik: {
    type: "array",
    minItems: 1,
    description: "Chains that reach: each for a target, or along a curve.",
    items: {
      type: "object",
      properties: {
        bone: {
          type: "string",
          description:
            "The chain's last bone: a shin, a forearm, a tail's tip.",
        },
        armature: {
          type: "string",
          description: "By default the armature that has the bone.",
        },
        target: {
          type: "string",
          description:
            "The object the tip reaches for; one not in the scene is made, an empty at the tip.",
        },
        curve: {
          type: "string",
          description: "A curve the chain lies along, from its start.",
        },
        chain: {
          type: "integer",
          minimum: 1,
          description: `How many bones the chain holds, the last included; ${rig.target_chain} for a target by default, every bone to the root for a curve.`,
        },
        pole: {
          type: "string",
          description:
            "The object the bend points to, a knee's or an elbow's; one not in the scene is made on the side the chain bends, a chain's length out.",
        },
        stretch: {
          type: "boolean",
          description:
            "Bones stretch past their length to reach, or to fit the whole curve; false by default.",
        },
      },
      required: ["bone"],
      additionalProperties: false,
    },
  },
} as const;
