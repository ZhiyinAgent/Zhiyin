/** blender_rig's inputs for bones and a ready rig fitted to a body. */

const point = {
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
} as const;

/** The kinds of ready rig: Rigify's metarigs that ship with Blender. */
export const readyRigKinds = [
  "human",
  "basic_human",
  "quadruped",
  "cat",
  "wolf",
  "horse",
  "bird",
  "shark",
] as const;

/** blender_rig's description, the half that says what bones and ready rigs do. */
export const rigBonesDescribed =
  "Make bones in an armature, edit them as a list, mirror one side to the other and gather them in bone collections; or fit one of Rigify's ready rigs to a body mesh, its joints placed by the body's measured sections, and generate the rig. The answer gives each bone's length, ends, roll, parent and the mesh pieces it lies in, its chains from root to tip and its symmetry pairs; for a ready rig, each joint with what it was fitted to and what could not be found, to confirm by looking. Bones and kinds: open doc:3d-rendering/rigging-bones.";

export const rigBoneProperties = {
  armature: {
    type: "string",
    description:
      'The armature object, made at the origin when missing. With from, the rig\'s name ("<mesh> rig" by default); its metarig is "<name> metarig", whose bones a later call moves to generate it again.',
  },
  bones: {
    type: "array",
    minItems: 1,
    description: "Bones added, or changed by name keeping what is not given.",
    items: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "A bone of that name is changed; else one is added.",
        },
        head: {
          ...point,
          description:
            "Its root end in the world, in metres; a new bone connected to a parent needs none.",
        },
        tail: {
          ...point,
          description:
            "Its tip end in the world, in metres; a new bone needs one.",
        },
        parent: { type: "string", description: "A bone; empty for none." },
        connected: {
          type: "boolean",
          description: "Its head held on the parent's tail.",
        },
        roll: { type: "number", description: "Degrees about its length." },
        deform: {
          type: "boolean",
          description: "Moves the mesh; true by default.",
        },
        collection: { type: "string", description: "A bone collection." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  bone_edits: {
    type: "array",
    minItems: 1,
    description: "Edits of one bone each, in order.",
    items: {
      type: "object",
      properties: {
        bone: { type: "string", description: "The bone edited." },
        kind: {
          type: "string",
          enum: ["extrude", "subdivide", "duplicate", "rename", "remove"],
          description:
            "extrude: a connected bone from its tail to `to`; subdivide into `count`; duplicate with the bones below it; rename to `name`; remove, its children going to its parent.",
        },
        to: {
          ...point,
          description: "extrude: the new bone's tip in the world, in metres.",
        },
        name: {
          type: "string",
          description: "extrude: the new bone's name; rename: its new name.",
        },
        count: {
          type: "integer",
          description: "subdivide: how many bones it becomes.",
        },
        offset: {
          ...point,
          description:
            "duplicate: how far the copies move in the world, in metres.",
        },
        replace: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2,
          description:
            'duplicate: [text in the names, text it becomes], as [".L", ".R"].',
        },
      },
      required: ["bone", "kind"],
      additionalProperties: false,
    },
  },
  symmetrize: {
    type: "string",
    enum: ["L", "R"],
    description:
      "Mirror the bones named for this side (.L, _L, Left) across the armature's x = 0 onto the other side's names, replacing them.",
  },
  collections: {
    type: "array",
    minItems: 1,
    description: "Bone collections, made when missing.",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "The collection's name." },
        bones: {
          type: "array",
          items: { type: "string" },
          description: "Bones put in it; they stay in their others.",
        },
        visible: {
          type: "boolean",
          description: "Whether its bones show in the view.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  from: {
    type: "object",
    description:
      "A ready rig fitted to a mesh standing on its lowest point, x across, z up.",
    properties: {
      kind: {
        type: "string",
        enum: readyRigKinds,
        description: "Which of Rigify's ready rigs.",
      },
      fit_to: { type: "string", description: "The body mesh." },
      facing: {
        type: "string",
        enum: ["-y", "+y", "+x", "-x"],
        description: "Where its front looks; -y by default.",
      },
    },
    required: ["kind", "fit_to"],
    additionalProperties: false,
  },
} as const;
