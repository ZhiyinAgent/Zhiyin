/**
 * The tools the model is offered, with their schemas. Sizes and positions are
 * in metres and angles in degrees, as people give them. An object's location
 * is its origin, as in Blender, and the rule is stated where the model reads
 * it: in the tools' own descriptions.
 *
 * Every input has one type. A model whose provider turns its written-out call
 * back into arguments reads each value by its declared type, and an input that
 * may be either a name or a point arrived cut off at that value.
 */

import { decalTools } from "./decal-tools.js";
import { rigTools } from "./rig-tools.js";
import { simulateTools } from "./simulate-tools.js";
import {
  lightLinking,
  lightShaping,
  pictureLooks,
  renderLooks,
  renderSampling,
} from "./look-schema.js";
import { measureTools } from "./measure-tools.js";
import { modellingTools } from "./modelling-tools.js";
import { motionTools } from "./motion-tools.js";
import { scatterTools } from "./scatter-tools.js";
import { surfacingTools } from "./surfacing-tools.js";
import { uvTools } from "./uv-tools.js";
import {
  colour,
  objectNames,
  point2,
  vector3,
  workspaceFile,
  type StudioTool,
} from "./schema-parts.js";
import { largestScript } from "./script-call.js";
import { statedNumbers, statedWords } from "./stated-numbers.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

export type { StudioTool } from "./schema-parts.js";

/** The space a framing leaves round what it fits. */
const margin = {
  type: "number",
  minimum: 0,
  maximum: 0.9,
  default: 0.1,
  description: "Space around, as a share of the picture.",
};

export const studioTools: readonly StudioTool[] = [
  {
    name: "blender_open_scene",
    label: "Open a 3D scene",
    checksWork: "runs",
    description: `Open a Blender scene file in the workspace, or create a new empty one. Every other Blender tool works on the scene opened here, and the scene file is saved after every change. The person watches each change in the 3D view. After every change, and when it is opened or described, the scene is measured against its spec, requirements.json beside the scene file or at the workspace's top: write it before modelling, with the parts' real sizes as ranges and how they sit together; its kinds and fields: open doc:3d-rendering/spec. ${timeLimitStated("open")}`,
    inputSchema: {
      type: "object",
      properties: {
        path: workspaceFile("Workspace-relative path of a .blend file."),
        create: {
          type: "boolean",
          description:
            "Create a new empty scene when the file does not exist. Never replaces an existing file.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  ...modellingTools,
  ...surfacingTools,
  ...scatterTools,
  ...decalTools,
  ...uvTools,
  ...measureTools,
  ...rigTools,
  ...simulateTools,
  {
    name: "blender_set_camera",
    toolkit: toolkits.lightAndCamera.id,
    label: "Set the camera of a 3D scene",
    checksWork: "runs",
    description: `Set the scene's camera: frame objects from any side, centred in the picture, or place it and aim it at a point or at an object's middle; lens or orthographic, lens shift, depth of field, picture size, exposure and tone, and outlines; a render's post (bloom, vignette and the rest) is blender_render's. The answer says which objects the picture shows whole, cuts off, has hidden behind others or misses, and when the camera is inside a shape. Framing, lenses, shift and tones in detail: open doc:3d-rendering/camera. ${timeLimitStated("camera")}`,
    inputSchema: {
      type: "object",
      properties: {
        frame: {
          type: "object",
          description:
            "Place the camera to fit objects in the picture, centred, seen from a side.",
          properties: {
            objects: {
              type: "array",
              items: { type: "string" },
              description:
                "What to fit in the picture; everything by default. A name between slashes, such as /Spring_.*/, stands for every object whose whole name it matches; the answer says which.",
            },
            direction: {
              type: "string",
              enum: ["front", "back", "left", "right", "three-quarter", "top"],
              description:
                "top looks straight down with +y up the picture and +x to the right, as a plan reads with north up.",
            },
            margin,
            around: {
              type: "number",
              description:
                "Degrees to move round the objects from the direction, anticlockwise seen from above; from the top it turns the picture.",
            },
            elevation: {
              type: "number",
              description:
                "Degrees above level to look from: 0 eye level, 90 straight down.",
            },
          },
        },
        orthographic: {
          type: "boolean",
          description:
            "true for a picture without perspective, as a plan or an elevation drawing, sized to what is framed; false for perspective again.",
        },
        location: vector3("Camera position in metres, when not framing."),
        look_at: vector3("A point to aim at, in metres, when not framing."),
        look_at_object: {
          type: "string",
          description: "An object to aim at the middle of, when not framing.",
        },
        lens: {
          type: "number",
          description:
            "Focal length in mm. 50 is natural, 85 to 100 flatters products.",
        },
        shift: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description:
            "Lens shift, [across, up], each a share of the picture's longer side: slides what the camera sees without turning it. It stays until set again; [0, 0] removes it.",
        },
        depth_of_field: {
          type: "object",
          description: "Blur with distance from what is in focus.",
          properties: {
            focus_object: {
              type: "string",
              description:
                "An object to keep in focus, at its middle, wherever it or the camera moves.",
            },
            focus_distance: {
              type: "number",
              description: "Or a distance to focus at, in metres.",
            },
            aperture: {
              type: "number",
              minimum: 0.5,
              maximum: 128,
              default: 2.8,
              description: "f-stop; lower blurs more.",
            },
            off: {
              type: "boolean",
              description: "Turn the background blur off.",
            },
          },
          additionalProperties: false,
        },
        resolution: {
          ...point2,
          description: "Picture size in pixels, width and height.",
        },
        exposure: {
          type: "number",
          default: 0,
          description: "In stops, the whole picture: +1 doubles the light.",
        },
        tone: {
          type: "string",
          enum: ["agx", "neutral", "standard"],
          description:
            "How light becomes colours: agx (Blender's default) keeps highlights but lightens deep colours; neutral shows colours as given; standard clips above white.",
        },
        ...pictureLooks,
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_set_lighting",
    toolkit: toolkits.lightAndCamera.id,
    label: "Light a 3D scene",
    checksWork: "runs",
    description: `Light the scene: a preset (studio, product with a seamless white backdrop all around, daylight), a background colour, a picture of surroundings (an HDRI, or one of Blender's own), a sky with the sun, or individual lights, with which objects each lights and lets cast its shadows; cards seen only in reflections or by light, which rays see objects, fog, and caustics. A light named like one in the scene changes only what is given, and a moved light stays aimed where it was. Cards, fog and caustics are measured in small Cycles pictures with them and without. Each part can be sent alone. Presets, skies, the sun's bearing and strength, light shapes and the backdrop in detail: open doc:3d-rendering/lighting. ${timeLimitStated("lighting")}`,
    inputSchema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["studio", "product", "daylight", "none"],
          description:
            "Replaces what a preset made before; the model's own lights stay.",
        },
        background: {
          type: "object",
          description:
            "What surrounds the scene and lights it: a colour, or one of an hdri, an environment or a sky.",
          properties: {
            color: colour(
              "A plain background; with an hdri or an environment, what the camera sees behind the scene.",
            ),
            hdri: workspaceFile(
              "A .hdr or .exr picture of surroundings in the workspace.",
            ),
            environment: {
              type: "string",
              enum: [
                "studio",
                "city",
                "courtyard",
                "forest",
                "interior",
                "night",
                "sunrise",
                "sunset",
              ],
              description:
                "One of Blender's own photographed surroundings, instead of an hdri.",
            },
            rotation: {
              type: "number",
              description: "hdri or environment: turn it, in degrees.",
            },
            sky: {
              type: "object",
              properties: {
                sun_elevation: {
                  type: "number",
                  minimum: -10,
                  maximum: 90,
                  default: 35,
                  description: "Degrees above the horizon.",
                },
                sun_rotation: {
                  type: "number",
                  default: 0,
                  description:
                    "The side the sun stands on, a compass bearing in degrees with +y as north (90 is +x); its light travels the other way.",
                },
              },
              description: "A sky over level ground, with the sun in it.",
            },
            strength: {
              type: "number",
              description:
                "A multiple of the light it gives: 1 as the colour or picture is.",
            },
          },
        },
        lights: {
          type: "array",
          description: "Lights to add, or to change by name.",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Left out, its kind's, as “Spot light”.",
              },
              kind: {
                type: "string",
                enum: ["area", "point", "spot", "sun"],
                description: "A new light's; a light keeps its own.",
              },
              location: vector3("In metres."),
              look_at: {
                ...vector3("A point to aim at, in metres."),
                default: [0, 0, 0],
              },
              look_at_object: {
                type: "string",
                description: "Or an object to aim at the middle of.",
              },
              power: {
                type: "number",
                description: "Watts, for area, point and spot lights.",
              },
              strength: {
                type: "number",
                default: 3,
                description:
                  "sun: watts per square metre; π lights a white matt surface square to it to white.",
              },
              angle: {
                type: "number",
                default: 0.53,
                description:
                  "sun: its width in the sky in degrees, softening shadows.",
              },
              color: colour("Light colour."),
              kelvin: {
                type: "number",
                description: `Colour temperature in kelvin, ${statedNumbers.lighting.least_kelvin} to ${statedNumbers.lighting.most_kelvin} (2700 bulb, 5600 daylight), times the colour; 0 for none.`,
              },
              exposure: {
                type: "number",
                description: "In stops, this light only.",
              },
              shape: {
                type: "string",
                enum: ["square", "rectangle", "disk", "ellipse"],
                description:
                  "area: disk is a round softbox, a thin rectangle a strip light.",
              },
              size: {
                ...point2,
                description:
                  "area: [width, height] in metres; larger is softer.",
              },
              spot_angle: {
                type: "number",
                description: "spot: cone angle in degrees.",
              },
              ...lightLinking,
            },
            additionalProperties: false,
          },
        },
        replace: {
          type: "boolean",
          description: "Remove every light made before; a backdrop stays.",
        },
        backdrop_reflections: {
          type: "number",
          minimum: 0,
          maximum: 1,
          default: 0.25,
          description:
            "The share of its brightness the product backdrop shows in reflections; the default keeps glossy colours as given. Raise it toward 1 only for chrome and glass.",
        },
        ...lightShaping,
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_render",
    label: "Render a 3D scene",
    checksWork: "runs",
    description: `Render a still picture to the workspace: through the scene's camera, with Cycles (the picture to hand over, on the graphics card when there is one) or EEVEE (a fast draft for layout and framing: judge colours, brightness, glass and liquids in Cycles; final for toon and stylised work); or, with view plan, the plan of the whole scene from straight above, in one call that leaves the scene as it was. A still of an animation is taken at a time. The picture opens beside the conversation, and the answer gives the tone and exposure it was made with, the colour each object shows in it, its ΔE to its material's, and the background's, and, for Cycles, which surfaces are lit past their own colours with the exposure that shows them as they are. It measures the picture's light: the share clipped to white and crushed to black, its middle against middle grey, and where the subject sits; with Cycles, its noise, fireflies and what denoising smoothed, the samples reached and what stopped them, and a large picture is timed from two small ones first and refused when it would not finish within the limit; with outlines or toon, how much of each silhouette is lined and the bands shown. Engines, plans, backgrounds, post and parts alone in detail: open doc:3d-rendering/rendering. ${timeLimitStated("render")}`,
    inputSchema: {
      type: "object",
      properties: {
        output: workspaceFile(
          "Workspace-relative .png or .jpg path, or a whole path outside the workspace, which the person approves.",
        ),
        engine: {
          type: "string",
          enum: ["cycles", "eevee"],
          description:
            "For a picture through the camera; cycles by default. A plan is always drawn with EEVEE: leave engine out.",
        },
        samples: {
          type: "integer",
          description: `How many samples each pixel takes; more is cleaner and slower. Cycles ${statedNumbers.render.cycles_samples}, EEVEE ${statedNumbers.render.eevee_samples} by default.`,
        },
        resolution: {
          ...point2,
          description:
            "Width and height in pixels. Through the camera it becomes the scene's picture size; for a plan it is this picture's only.",
        },
        view: {
          type: "string",
          enum: ["camera", "plan"],
          description:
            "camera (default): through the scene's camera. plan: the whole scene from straight above, +y up, cut as a drawn plan is and lit evenly; the scene's camera, lights and settings stay as they were.",
        },
        cut: {
          type: "number",
          description: `For a plan: the height it is cut at, in metres up z; ${statedNumbers.render.plan_cut} m above the floor by default, which a plan a person reads should keep.`,
        },
        without: {
          type: "array",
          items: { type: "string" },
          description:
            "Objects left out of this picture only, with what is attached to them; the scene keeps them. A name between slashes, such as /Spring_.*/, stands for every object whose whole name it matches.",
        },
        only: {
          type: "array",
          items: { type: "string" },
          description:
            "The only objects this picture shows, with what is attached to them, the lights and backdrop staying; not with without. Names between slashes match as in without.",
        },
        frame: {
          type: "object",
          properties: {
            objects: {
              type: "array",
              items: { type: "string" },
              description:
                "What to fit in the picture; by default what it shows. Names between slashes match as in without.",
            },
            direction: {
              type: "string",
              enum: ["front", "back", "left", "right", "three-quarter", "top"],
              description: "The side it is seen from, as the camera's frame.",
            },
            margin,
            around: {
              type: "number",
              description:
                "Degrees to move round from the direction, anticlockwise seen from above, as blender_set_camera's frame takes them.",
            },
            elevation: {
              type: "number",
              description: "Degrees above level to look from.",
            },
          },
          additionalProperties: false,
          description:
            "Frames this picture alone, as blender_set_camera's frame does, through a copy of the camera with its lens: the scene's camera stays where it was. With only, each part of a set is pictured in turn, one call each.",
        },
        background: {
          type: "string",
          enum: ["scene", "white", "transparent"],
          description: `What surrounds the product: ${statedWords.render.background} (default); white, exact #ffffff with the product's shadow, Cycles only; transparent, .png only.`,
        },
        camera: {
          type: "string",
          description:
            "Render this picture through this camera; the scene keeps its own camera.",
        },
        time: {
          type: "number",
          description:
            "A moment of the animation to render, in seconds; the scene stays at the frame it was on.",
        },
        noise: {
          type: "boolean",
          description: `Cycles: true measures noise and denoising from two half-size pictures, half as long again; false never; by default when the picture took ${statedNumbers.render.cheap_seconds} s or less.`,
        },
        ...renderSampling,
        ...renderLooks,
      },
      required: ["output"],
      additionalProperties: false,
    },
  },
  ...motionTools,
  {
    name: "blender_export",
    toolkit: toolkits.output.id,
    label: "Export a 3D model",
    checksWork: "runs",
    description: `Export objects to one model file in the workspace: .glb for the web, with materials and pictures inside; .stl for 3D printing (in millimetres); .obj (shapes only), .fbx, .usd or .ply. Editable steps such as holes are applied in the file, and named objects are exported even when hidden. The answer names each look the format cannot hold; with bake, those are baked into pictures the file carries, for the file only, and the call may then run for up to 30 minutes. ${timeLimitStated("export")}`,
    inputSchema: {
      type: "object",
      properties: {
        output: workspaceFile(
          "Workspace-relative path, or a whole path outside the workspace, which the person approves; the extension picks the format.",
        ),
        objects: {
          type: "array",
          items: { type: "string" },
          description:
            "What to export; every visible object by default. A name between slashes, such as /Spring_.*/, stands for every object whose whole name it matches; the answer says which.",
        },
        bake: {
          type: "boolean",
          description:
            "Bake each look built from nodes the format cannot hold (colour, metal, roughness, relief, glow, opacity) into pictures packed in the file; the scene keeps its materials. A .glb only, which carries its pictures inside.",
        },
        bake_size: {
          type: "integer",
          minimum: 32,
          maximum: 4096,
          default: 1024,
          description: "The baked pictures' width and height in pixels.",
        },
      },
      required: ["output"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_describe_scene",
    label: "Describe a 3D scene",
    access: "read",
    reportsState: true,
    description: `Describe the open scene: each object's size, origin, bottom and top heights, what it goes into, its materials with their values and its editing steps with theirs, whether its mesh is closed and its volume; the meshes still as blender_add_objects made them, primitives no edit or step has changed since, however moved, turned or resized, the meshes with sharp edges and the parts pushed into the object they belong to, as a look and a render also say; see-through shapes whose surfaces are in the same place, which a picture shows as wedges; the camera and what its picture shows; the lights with their size and aim; the render settings, tone and exposure. Also shows the latest preview picture to a model that can see pictures. ${timeLimitStated("describe")}`,
    inputSchema: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          items: { type: "string" },
          description:
            "Only these objects. A name between slashes, such as /Spring_.*/, stands for every object whose whole name it matches; the answer says which.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_look",
    label: "Look at a 3D scene from four sides",
    access: "read",
    checksWork: "runs",
    description: `Look at the scene, or the objects named, from the front, the right, the top and three-quarter on one picture you can see, the first three drawn flat, each framed on them. shading: shaded, in each surface's colour; wireframe, every edge drawn over the surface; faces, blue where a face points outward and red where it points inward; reflections, a light in bands reflected on every surface, which bend smoothly on a smooth surface and kink or break where it creases or its curvature jumps, with how far each object's neighbouring faces turn from each other and where most. With it, each object's mesh counted: closed or its open edges, faces pointing inward and where, faces of more than 4 sides and where, its pieces and loose points, its thinnest wall, and the faces a script left selected; objects with a fault come first. A model that cannot see pictures gets the counts alone. Use it after modelling, from every side, before a render: a fault in one view is often hidden in another. It changes nothing. ${timeLimitStated("look")}`,
    inputSchema: {
      type: "object",
      properties: {
        objects: {
          ...objectNames,
          description:
            "What to look at, with the parts attached to them; the whole scene by default. A name between slashes, such as /Spring_.*/, stands for every object whose whole name it matches; the answer says which.",
        },
        shading: {
          type: "string",
          enum: ["shaded", "wireframe", "faces", "reflections"],
          description: "shaded by default.",
        },
        stripes: {
          type: "string",
          enum: ["x", "y", "z"],
          description:
            "reflections: the axis of the world the light's bands lie across; z by default, bands like a studio's strip lights.",
        },
        time: {
          type: "number",
          description:
            "The moment of the animation to look at, in seconds; the scene's own by default.",
        },
        tile_width: {
          type: "integer",
          minimum: 160,
          maximum: 800,
          default: 480,
          description: "Each view's width in pixels.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_api",
    label: "Look up Blender's API",
    access: "read",
    description: `Ask the installed Blender what its Python API accepts: a type's properties and allowed values, a node's inputs, or an operator's parameters. Use before writing a script. Examples: Object, ShaderNodeBsdfPrincipled, Principled BSDF, bpy.ops.mesh.bevel. The whole API of this Blender is also in the catalog, a page for each type and operator module: open doc:blender/api. ${timeLimitStated("api")}`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "One type, node or operator, by its Python name or as Blender shows it.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_run_script",
    label: "Run a Blender script in a 3D scene",
    checksWork: "runs",
    description: `Run Blender Python (bpy) in the open scene, for what the other tools do not cover: a form their shapes and steps do not give, modelled with zhiyin's edits on picked faces, edges and loops and with Blender's own modifiers, curves and geometry nodes, or anything else, such as physics. Beside bpy it has zhiyin, Zhiyin's library, whose functions are in the catalog. It runs in the workspace folder, reads and writes only the person's files inside the workspace, has no internet and has no numpy.random; a folder outside the workspace is written through outside_folders. The answer gives what the script printed, what its zhiyin calls did, and what it added, moved, resized and removed, with each object's size, bottom and top and what it goes into. A script that fails leaves the scene as it was saved, and the answer says what Blender 5.2 changed when the error shows a known change. How paths are read, folders outside the workspace and the answer, in detail: open doc:3d-rendering/scripts. ${timeLimitStated("script")}`,
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          maxLength: largestScript,
          description: `Python using bpy, at most ${largestScript.toLocaleString("en")} characters; split longer work over several calls.`,
        },
        outside_folders: {
          type: "array",
          items: { type: "string" },
          description:
            "Whole paths of folders outside the workspace the script writes files in, which Zhiyin copies first so the changes can be undone, and which the person approves. Blender cannot write them itself: the script writes each folder's files into OUTSIDE_FOLDERS[folder], a folder of its own, keeping any folders it makes there, and they are moved into that folder when the script ends. A script that fails has nothing moved.",
        },
        change_locked: {
          type: "array",
          items: { type: "string" },
          description:
            "Files the script must change that Zhiyin made read-only for its run because it could not copy them first, as a run's answer names them: in the workspace by their path there, in an outside folder by their whole path. The change cannot be undone, so the person is asked; for a call naming one such file, they may allow changes to it for the conversation. Leave it out otherwise.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
];
