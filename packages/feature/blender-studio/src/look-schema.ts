/**
 * The inputs that shape how a picture is lit and drawn, spread into the
 * camera, lighting, render and animation schemas: which objects a light
 * lights and lets cast its shadows, cards and the rays that see objects,
 * fog, caustics, outlines, Cycles's sampling, a render's post, EEVEE's quality, toon
 * shading, and what a motion does past its keys.
 */

import { colour, point2, vector3 } from "./schema-parts.js";

const names = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

/** Light and shadow linking, on each light. */
export const lightLinking = {
  lights_only: names(
    "Only these objects, with their parts, get its light; [] lights all again.",
  ),
  lights_except: names("These get none of its light."),
  shadows_only: names("Only these cast its shadows; [] lets all again."),
  shadows_except: names("These cast none of its shadows."),
};

/** The rays that can see an object, as Cycles draws it. */
const rays = {
  camera: { type: "boolean", description: "Seen by the camera." },
  bounced: { type: "boolean", description: "Light bouncing off it." },
  reflections: { type: "boolean", description: "Seen in reflections." },
  refraction: { type: "boolean", description: "Seen through glass." },
  shadows: { type: "boolean", description: "false: it casts none." },
  fog: { type: "boolean", description: "Seen by light scattered in fog." },
};

/** Cards, the rays that see objects, fog and caustics, beside the lights. */
export const lightShaping = {
  cards: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "A card of that name changes only what is given.",
        },
        kind: {
          type: "string",
          enum: ["reflection", "bounce", "flag"],
          description:
            "reflection: a glowing panel seen only in reflections and through glass; bounce: a white card that only bounces light; flag: a black card that only blocks light. The camera sees none.",
        },
        location: vector3("Its middle, in metres."),
        look_at: vector3(
          "A point its face turns to, in metres; the scene's middle by default.",
        ),
        look_at_object: {
          type: "string",
          description: "Or an object's middle.",
        },
        size: {
          ...point2,
          default: [1, 1],
          description: "Width and height in metres.",
        },
        color: colour("Its colour."),
        strength: {
          type: "number",
          default: 4,
          description:
            "reflection: a multiple of its colour's brightness, 1 as given.",
        },
        seen_by: {
          type: "object",
          properties: rays,
          additionalProperties: false,
          description: "Its own rays, over its kind's.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    description: "Panels that shape the light.",
  },
  seen_by: {
    type: "array",
    items: {
      type: "object",
      properties: {
        objects: names("Objects, with their parts."),
        ...rays,
      },
      required: ["objects"],
      additionalProperties: false,
    },
    description:
      "Which rays see objects, as Cycles draws them; EEVEE keeps only camera and shadows.",
  },
  fog: {
    type: "object",
    description: "Fog round the scene, in the world or in objects.",
    properties: {
      density: {
        type: "number",
        description:
          "Per metre: 0.02 haze, 0.2 smoke; 0 removes the fog made here.",
      },
      anisotropy: {
        type: "number",
        minimum: -1,
        maximum: 1,
        default: 0,
        description:
          "-1 scatters light back, 0 evenly, 1 onward: above 0 shafts show looking toward a light.",
      },
      color: colour("Its colour; white by default."),
      objects: names("Fill these objects instead, as a beam or a cloud."),
      world: {
        type: "boolean",
        description:
          "true: endless fog, which a sun's light never gets through; by default a box round the scene and the camera, which a sun shines into.",
      },
      height_falloff: {
        type: "number",
        description:
          "Metres over which it halves above the scene's lowest point.",
      },
    },
    required: ["density"],
    additionalProperties: false,
  },
  caustics: {
    type: "object",
    description:
      "Light that glass and mirrors focus, which Cycles draws and EEVEE does not.",
    properties: {
      reflective: { type: "boolean", description: "Draw what mirrors focus." },
      refractive: { type: "boolean", description: "Draw what glass focuses." },
      filter_glossy: {
        type: "number",
        default: 1,
        description:
          "A blur of sharp light paths after a rough bounce, cutting their noise: 0 keeps caustics sharp, 1 is Cycles's own.",
      },
      casters: names("Glass whose shadow caustics are drawn (MNEE); [] none."),
      receivers: names("Where those fall."),
      lights: names("The lights that make them."),
      path_guiding: {
        type: "boolean",
        description: "Finds caustics sooner; on the processor only.",
      },
    },
    additionalProperties: false,
  },
};

/**
 * The steps of a render's post: Blender's own compositor nodes, then its
 * compositor groups bundled as assets.
 */
const postSteps = [
  "bloom",
  "glow",
  "streaks",
  "ghosts",
  "star",
  "sun_beams",
  "lens_distortion",
  "sharpen",
  "color_balance",
  "painterly",
  "vignette",
  "film_grain",
  "sensor_noise",
  "chromatic_aberration",
  "sepia",
  "split_toning",
  "unsharp_mask",
  "tune_image",
] as const;

/** Outlines, beside the camera's tone and exposure. */
export const pictureLooks = {
  outlines: {
    type: "object",
    description: "Lines drawn on the objects in the picture.",
    properties: {
      method: {
        type: "string",
        enum: ["freestyle", "line_art", "hull", "none"],
        description:
          "freestyle: lines drawn after the render along silhouettes, borders and creases; line_art: the same as a Grease Pencil object kept in the scene; hull: a dark shell round each object, as zhiyin.outline; none removes them.",
      },
      thickness: {
        type: "number",
        default: 2,
        description: "Line width in pixels of the picture.",
      },
      color: colour("Black by default."),
      objects: names("Only these; everything shown by default."),
      crease: {
        type: "number",
        description:
          "freestyle, line_art: edges sharper than this many degrees between faces are drawn.",
      },
    },
    required: ["method"],
    additionalProperties: false,
  },
};

/** A render's post and EEVEE's quality, each kept in the scene. */
export const renderLooks = {
  post: {
    type: "array",
    items: {
      type: "object",
      properties: {
        step: {
          type: "string",
          enum: [...postSteps],
          description: "One of Blender's compositor steps.",
        },
        amount: {
          type: "number",
          minimum: 0,
          maximum: 1,
          default: 1,
          description: "The share of the step's result mixed over the picture.",
        },
        threshold: {
          type: "number",
          description:
            "Glares: the brightness a pixel glows past, a multiple of white; measured by default.",
        },
        inputs: {
          type: "object",
          description: 'By Blender\'s names, such as {"Feather": 0.6}.',
        },
      },
      required: ["step"],
      additionalProperties: false,
    },
    description:
      "Compositor steps over this and every later render and video, in order; [] removes them.",
  },
  eevee: {
    type: "object",
    description: "Kept in the scene.",
    properties: {
      final: {
        type: "boolean",
        description: "true: EEVEE's is the picture to hand over, as for toon.",
      },
      shadows: {
        type: "object",
        description: "Its soft shadows; more is cleaner and slower.",
        properties: {
          rays: {
            type: "integer",
            minimum: 1,
            maximum: 4,
            description: "How many rays each light's shadow is traced with.",
          },
          steps: {
            type: "integer",
            minimum: 1,
            maximum: 16,
            description: "How many steps each shadow ray takes.",
          },
          resolution: {
            type: "number",
            minimum: 0.1,
            maximum: 1,
            description: "The shadow maps' share of their full resolution.",
          },
        },
        additionalProperties: false,
      },
      raytracing: {
        type: "object",
        description: "Its reflections and refraction.",
        properties: {
          method: {
            type: "string",
            enum: ["screen", "probe", "off"],
            description:
              "screen: traced in the picture; probe: from light probes; off: none traced.",
          },
          resolution: {
            type: "integer",
            enum: [1, 2, 4, 8, 16],
            description: "Pixels across per ray traced: 1 traces every pixel.",
          },
        },
        additionalProperties: false,
      },
      volumes: {
        type: "object",
        description: "Its fog and smoke.",
        properties: {
          tile: {
            type: "integer",
            enum: [1, 2, 4, 8, 16],
            description: "Pixels across each volume tile; smaller is finer.",
          },
          samples: {
            type: "integer",
            minimum: 1,
            maximum: 256,
            description: "How many samples each volume takes in depth.",
          },
          shadows: {
            type: "boolean",
            description: "Volumes cast shadows.",
          },
        },
        additionalProperties: false,
      },
      probes: {
        type: "boolean",
        description: "Bake light probes, fitting a volume round the scene.",
      },
    },
    additionalProperties: false,
  },
};

/** Toon shading on a material, in flat bands of light. */
export const toonShading = {
  toon: {
    type: "object",
    description: "Cel shading in flat bands of light.",
    properties: {
      bands: {
        type: "integer",
        minimum: 1,
        maximum: 8,
        default: 3,
        description: "How many flat bands of light, darkest to the colour.",
      },
      shadow: {
        type: "number",
        default: 0.35,
        description: "The darkest band's share of the colour.",
      },
      shadow_color: colour("Or a tint for the darkest band."),
      rim: {
        type: "object",
        description:
          "A colour added where the surface turns away from the camera.",
        properties: {
          color: colour("The colour added."),
          width: {
            type: "number",
            minimum: 0.01,
            maximum: 1,
            description:
              "How far in from the edge it reaches, as a share of the way to facing the camera.",
          },
        },
        additionalProperties: false,
      },
      faceted: {
        type: "boolean",
        description: "Each face shaded flat, as a low-poly look.",
      },
    },
    additionalProperties: false,
  },
};

/** Cycles's sampling, kept in the scene. */
export const renderSampling = {
  sampling: {
    type: "object",
    description: "Cycles, kept in the scene.",
    properties: {
      noise_threshold: {
        type: "number",
        default: 0.01,
        description:
          "A pixel stops once its noise, as a ratio to its brightness, is under this; 0 samples every pixel fully.",
      },
      min_samples: {
        type: "integer",
        description:
          "How many samples every pixel takes first; 0 lets Cycles choose.",
      },
      time_limit: {
        type: "number",
        description: "Seconds the picture may take; 0 for none.",
      },
      seed: {
        type: "integer",
        description: "The same seed gives the same noise.",
      },
      pattern: {
        type: "string",
        enum: ["automatic", "tabulated_sobol", "blue_noise"],
        description: "How samples are spread over a pixel.",
      },
      denoise: {
        type: "string",
        enum: ["off", "fast", "best"],
        description: "OpenImageDenoise; best is high quality, accurate.",
      },
      clamp: {
        type: "object",
        description:
          "The brightest a sample may be, against fireflies; 0 none. It dims caustics.",
        properties: {
          direct: {
            type: "number",
            description: "Light straight from a source, a multiple of white.",
          },
          indirect: {
            type: "number",
            description: "Light that has bounced, a multiple of white.",
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
};

/** What a motion does past its first and last keys. */
export const motionExtension = {
  extend: {
    type: "array",
    items: {
      type: "object",
      properties: {
        object: { type: "string", description: "The keyed object." },
        mode: {
          type: "string",
          enum: ["hold", "continue", "repeat", "repeat_on", "back_and_forth"],
          description:
            "hold (default); continue at its end speeds; repeat its keys round, seamlessly; repeat_on, each round on from the last, as a wheel turns; back_and_forth.",
        },
      },
      required: ["object", "mode"],
      additionalProperties: false,
    },
    description:
      "An object's motion past its keys; the answer says if its ends meet in place and speed.",
  },
};
