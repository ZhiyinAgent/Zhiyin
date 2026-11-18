/**
 * The parts of a material that draw a surface on it: wood grain, a finish
 * drawn at its real size, and the wear, grime and other marks it gathers.
 */

/** A mark's amount, from none to the most it shows. */
const amount = (what: string) => ({
  type: "number",
  minimum: 0,
  maximum: 1,
  description: `${what} 0 none, 1 most.`,
});

export const finishProperties = {
  wood: {
    type: "number",
    minimum: 0,
    maximum: 1,
    description:
      "Wood grain, in the colour given, which is the wood's own (#c9a678 oak): 0 none, 1 bold, 0.5 calm. Not with a texture.",
  },
  finish: {
    type: "string",
    enum: [
      "cast-aluminium",
      "cast-iron",
      "machined-metal",
      "brushed-metal",
      "painted-metal",
      "plated-steel",
      "heat-tinted-steel",
      "anodised-aluminium",
      "galvanised-steel",
      "car-paint",
      "carbon-fibre",
      "textured-plastic",
      "rubber",
      "braided-steel",
      "leather",
      "fabric",
      "knit",
      "ceramic-glaze",
      "concrete",
      "stone",
      "marble",
      "frosted-glass",
      "paper",
      "cardboard",
      "skin",
    ],
    description:
      "A real surface drawn at its real size on any shape, with nothing to unwrap, in the colour given or its own. Not with wood or a texture; frosted-glass is the one that lets light through.",
  },
  brushing: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        enum: ["linear", "circular", "radial"],
        description:
          "linear: lines along the axis; circular: rings round it, as on a turned face; radial: lines out from it.",
      },
      axis: {
        type: "string",
        enum: ["x", "y", "z"],
        description:
          "An axis of the object's own. Left out: its longest side for linear, else the axis it is as wide round both ways, or its thinnest side.",
      },
    },
    additionalProperties: false,
    description: "With finish brushed-metal: how it was brushed.",
  },
  wear: amount("Edges and corners rubbed bright, in chips."),
  grime: amount("Dark dirt in recesses, corners and where parts meet."),
  rust: amount(
    "Pitted rust on edges and in corners, running down from edges as the object stands.",
  ),
  scratches: amount(
    "Fine scratches along the object's longest side, on its open faces.",
  ),
  drips: amount(
    "Dirty water streaks running down from edges as the object stands.",
  ),
  dust: amount(
    "Pale dust on faces that look up, less under what overhangs them.",
  ),
  fingerprints: amount("Oily prints on open faces, dulling a gloss."),
};
